import { WAKE_EVENT, WAKE_UPDATE_EVENT, type WakeNotice, type WakeResult, type WakeTarget } from "@team-31/protocol";
import type { BrokerDeps, TickReport } from "../ports.js";
import type { AgentConnectionRow, ChannelRow, RequestRow, StoreTx, WakeClaim } from "../store/store.js";

const batchSize = 100;
// Claim only work that can start immediately, independently of the expiry scan size.
const wakeConcurrency = 8;
const wakeLeaseMs = 60_000;

function actionable(row: RequestRow | null, job: WakeClaim, now: Date): row is RequestRow {
  return row?.status === "awaiting_agent" && row.version === job.requestVersion && row.expiresAt > now;
}

async function recipient(tx: StoreTx, row: RequestRow): Promise<AgentConnectionRow | undefined> {
  if (row.toUserId === null) return undefined;
  if (row.targetAgentId !== undefined) {
    const connection = await tx.getAgentConnection(row.toUserId, row.targetAgentId);
    return connection && !connection.revokedAt ? connection : undefined;
  }
  const agents = await tx.listAgentConnections(row.toUserId);
  return agents.filter((agent) => !agent.revokedAt && agent.wakeTarget.kind !== "none")
    .sort((a, b) => Number(Boolean(b.verifiedAt)) - Number(Boolean(a.verifiedAt))
      || a.createdAt.getTime() - b.createdAt.getTime()
      || a.agentId.localeCompare(b.agentId))[0];
}

async function origin(tx: StoreTx, row: RequestRow | null, job: WakeClaim): Promise<ChannelRow | undefined> {
  if (row?.version !== job.requestVersion || !row.fromUserId || !row.originChannel) return undefined;
  return await tx.getChannel(row.fromUserId, row.originChannel) ?? undefined;
}

type ClosePending = (tx: StoreTx, row: RequestRow, status: "expired" | "delivery_failed", at: Date) => Promise<boolean>;
type WorkerDeps = Pick<BrokerDeps, "store" | "waker" | "clock" | "telemetry"> & { wakeRetryDelaysMs: readonly number[] };

export function createWorker({ store, waker, clock, telemetry, wakeRetryDelaysMs }: WorkerDeps, closePending: ClosePending) {
  async function deliver(job: WakeClaim, target: WakeTarget, event: WakeNotice["event"],
    owner: { userId: string; agentId?: string }): Promise<WakeResult> {
    try {
      const { ok, retryable, ms, status } = await waker.wake(target, { requestId: job.requestId, event }, {
        queueWaitMs: Math.max(0, clock.now().getTime() - job.dueAt.getTime()),
        attempt: job.attempt, final: wakeRetryDelaysMs[job.attempt] === undefined, ...owner,
      });
      // Adapters may return diagnostic text. Persist only structured metadata.
      return { ok, retryable, ms, status };
    } catch (error) {
      telemetry?.error?.("wake.deliver", error, { requestId: job.requestId, ...owner });
      return { ok: false, retryable: true, ms: 0 };
    }
  }

  // Tells the channel a request came from that it changed. A failed notice never changes the request.
  async function runOriginNotice(job: WakeClaim) {
    const channel = await store.tx(async (tx) => origin(tx, await tx.getRequest(job.requestId), job));
    if (job.leaseUntil <= clock.now()) return;
    const fields = { requestId: job.requestId, userId: channel?.userId };
    if (job.recovered) telemetry?.emit("wake.lease_recovered", { ...fields, attrs: { attempt: job.attempt } });
    const exhausted = job.recovered && job.attempt > Math.max(1, wakeRetryDelaysMs.length);
    const result: WakeResult = exhausted ? { ok: false, retryable: false, ms: 0, detail: "lease_exhausted" }
      : !channel || channel.wakeTarget.kind === "none" ? { ok: false, retryable: false, ms: 0, detail: "skipped" }
      : await deliver(job, channel.wakeTarget, WAKE_UPDATE_EVENT, { userId: channel.userId });
    const completedAt = clock.now();
    const delay = result.retryable ? wakeRetryDelaysMs[job.attempt] : undefined;
    const retryAt = delay === undefined ? null : new Date(completedAt.getTime() + delay);
    const recorded = await store.tx((tx) => tx.recordWakeAttempt(job, completedAt, result, retryAt));
    if (recorded && channel && !result.ok && !retryAt) {
      telemetry?.emit("wake.exhausted", { ...fields, attrs: { kind: channel.wakeTarget.kind, attempts: job.attempt } });
    }
  }

  async function runWake(job: WakeClaim) {
    const candidate = await store.tx(async (tx) => {
      const row = await tx.getRequest(job.requestId);
      if (!actionable(row, job, clock.now())) return null;
      return { target: await recipient(tx, row), expiresAt: row.expiresAt, userId: row.toUserId };
    });
    const now = clock.now();
    if (job.leaseUntil <= now) return;
    const target = candidate && candidate.expiresAt > now ? candidate.target : undefined;
    const fields = { requestId: job.requestId, userId: candidate?.userId, agentId: target?.agentId };
    if (job.recovered) telemetry?.emit("wake.lease_recovered", { ...fields, attrs: { attempt: job.attempt } });
    const exhausted = job.recovered && job.attempt > Math.max(1, wakeRetryDelaysMs.length);
    const deliverTo = target?.wakeTarget.kind !== "none" ? target : undefined;
    const attempted = exhausted ? undefined : deliverTo;
    const result: WakeResult = attempted
      ? await deliver(job, attempted.wakeTarget, WAKE_EVENT, { userId: attempted.userId, agentId: attempted.agentId })
      : { ok: !deliverTo, retryable: false, ms: 0 };

    const outcome = await store.tx(async (tx): Promise<"wakesOk" | "wakesRetried" | "wakesFailed" | undefined> => {
      const current = await tx.getWakeForUpdate(job.requestId, job.requestVersion);
      if (current?.id !== job.id || current.attempt !== job.attempt || current.state !== "running") return;
      // Reply processing also locks the agent before changing the request.
      const agent = attempted ? await tx.getAgentConnection(attempted.userId, attempted.agentId, true) : null;
      const row = await tx.getRequest(job.requestId, undefined, true);
      const completedAt = clock.now();
      const active = actionable(row, job, completedAt);
      const delay = active && !result.ok && result.retryable ? wakeRetryDelaysMs[job.attempt] : undefined;
      const retryAt = delay === undefined ? null : new Date(completedAt.getTime() + delay);
      // All writes in this transaction are fenced by the same attempt that claimed the job.
      if (!await tx.recordWakeAttempt(job, completedAt, result, retryAt) || !active) return;

      if (agent && (!agent.lastWakeAt || agent.lastWakeAt < now)) {
        await tx.upsertAgentConnection({ ...agent, lastWakeAt: now });
      }
      const code = result.ok ? "ok" : exhausted ? "lease_exhausted" : "failed";
      await tx.appendEvent({ requestId: row.id, at: completedAt, kind: "wake", code });
      if (result.ok) return "wakesOk";
      if (retryAt) return "wakesRetried";
      return await closePending(tx, row, "delivery_failed", completedAt) ? "wakesFailed" : undefined;
    });
    if (outcome === "wakesFailed" && exhausted) {
      telemetry?.emit("wake.exhausted", { ...fields, attrs: { kind: target?.wakeTarget.kind, attempts: job.attempt - 1 } });
    }
    return outcome;
  }

  return async function tick(now: Date): Promise<TickReport> {
    const report = { expired: 0, wakesOk: 0, wakesRetried: 0, wakesFailed: 0 };
    report.expired = await store.tx(async (tx) => {
      const due = await tx.listDueForExpiry(now, batchSize);
      let closed = 0;
      for (const row of due) {
        if (await closePending(tx, row, "expired", now)) closed++;
      }
      return closed;
    });

    const claimAt = clock.now();
    const leaseUntil = new Date(claimAt.getTime() + wakeLeaseMs);
    const jobs = await store.tx((tx) => tx.claimDueWakes(claimAt, leaseUntil, wakeConcurrency));
    const results = await Promise.allSettled(jobs.map((job) => job.audience === "origin" ? runOriginNotice(job) : runWake(job)));
    for (const result of results) {
      // Wait for every lease before allowing the scheduler to start its next tick.
      if (result.status === "rejected") throw result.reason;
      if (result.value) report[result.value]++;
    }
    return report;
  };
}
