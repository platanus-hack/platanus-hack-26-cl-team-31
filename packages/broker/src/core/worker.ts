import { WAKE_EVENT, type WakeResult, type WakeTarget } from "@team-31/protocol";
import type { BrokerDeps, TickReport } from "../ports.js";
import type { AgentConnectionRow, RequestRow, StoreTx, WakeClaim } from "../store/store.js";
import { notifiesRecipient } from "./lifecycle.js";

const batchSize = 100;
// Claim only work that can start immediately, independently of the expiry scan size.
const wakeConcurrency = 8;
const wakeLeaseMs = 60_000;
// Same shape ops.v_wake_jobs accepts as `code`: a fixed identifier, never free text.
const resultDetail = /^[a-z_]{1,40}$/;

function actionable(row: RequestRow | null, job: WakeClaim, now: Date): row is RequestRow {
  return row !== null && notifiesRecipient(row) && row.version === job.requestVersion && row.expiresAt > now;
}

async function recipient(tx: StoreTx, row: RequestRow): Promise<AgentConnectionRow | undefined> {
  if (row.toUserId === null) return undefined;
  if (row.targetAgentId !== undefined) {
    const connection = await tx.getAgentConnection(row.toUserId, row.targetAgentId);
    return connection && !connection.revokedAt ? connection : undefined;
  }
  const agents = await tx.listAgentConnections(row.toUserId);
  return agents.filter((agent) => !agent.revokedAt && agent.wakeTarget.kind !== "none")
    // Un CLI que sondea va al final: si el titular tiene un canal push, ese se lleva el aviso.
    // Defensivo: hoy el índice agent_connections_one_active deja una sola conexión viva por titular,
    // así que esta ordenación no se alcanza. Se conserva para que, si esa restricción se relaja,
    // el sondeo no le robe el aviso a un canal push en silencio.
    .sort((a, b) => Number(a.wakeTarget.kind === "polling") - Number(b.wakeTarget.kind === "polling")
      || Number(Boolean(b.verifiedAt)) - Number(Boolean(a.verifiedAt))
      || a.createdAt.getTime() - b.createdAt.getTime()
      || a.agentId.localeCompare(b.agentId))[0];
}

type ClosePending = (tx: StoreTx, row: RequestRow, status: "expired" | "delivery_failed", at: Date) => Promise<boolean>;
type WorkerDeps = Pick<BrokerDeps, "store" | "waker" | "clock" | "telemetry"> & { wakeRetryDelaysMs: readonly number[] };

export function createWorker({ store, waker, clock, telemetry, wakeRetryDelaysMs }: WorkerDeps, closePending: ClosePending) {
  function exhaustedAttempts(job: WakeClaim): number | undefined {
    return job.recovered && job.attempt > Math.max(1, wakeRetryDelaysMs.length) ? job.attempt - 1 : undefined;
  }

  async function deliver(job: WakeClaim, target: WakeTarget,
    owner: { userId: string; agentId?: string }): Promise<WakeResult> {
    const final = wakeRetryDelaysMs[job.attempt] === undefined;
    try {
      const { ok, retryable, ms, status, detail } = await waker.wake(target, { requestId: job.requestId, event: WAKE_EVENT }, {
        queueWaitMs: Math.max(0, clock.now().getTime() - job.dueAt.getTime()),
        attempt: job.attempt, final, ...owner,
      });
      // Adapters may return diagnostic text. Persist only a short code, the shape ops.v_wake_jobs renders.
      const code = detail !== undefined && resultDetail.test(detail) ? { detail } : {};
      return { ok, retryable, ms, status, ...code };
    } catch (error) {
      telemetry?.error?.("wake.deliver", error, { requestId: job.requestId, ...owner });
      if (final) telemetry?.emit("wake.exhausted", { requestId: job.requestId, ...owner,
        attrs: { kind: target.kind, attempts: job.attempt } });
      return { ok: false, retryable: true, ms: 0 };
    }
  }

  async function runWake(job: WakeClaim) {
    // Older versions queued origin notices. Finish those jobs without contacting the retired channel.
    if (job.audience === "origin") {
      await store.tx((tx) => tx.recordWakeAttempt(job, clock.now(), {
        ok: false, retryable: false, ms: 0, detail: "channel_retired",
      }, null));
      return;
    }
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
    const exhausted = exhaustedAttempts(job);
    const deliverTo = target?.wakeTarget.kind !== "none" ? target : undefined;
    const attempted = exhausted ? undefined : deliverTo;
    const result: WakeResult = attempted
      ? await deliver(job, attempted.wakeTarget, { userId: attempted.userId, agentId: attempted.agentId })
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
      // A failed agent notification cannot close a decision still available to the holder.
      if (row.status === "awaiting_owner") return "wakesFailed";
      return await closePending(tx, row, "delivery_failed", completedAt) ? "wakesFailed" : undefined;
    });
    if (outcome === "wakesFailed" && exhausted) {
      telemetry?.emit("wake.exhausted", { ...fields, attrs: { kind: target?.wakeTarget.kind, attempts: exhausted } });
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
    const results = await Promise.allSettled(jobs.map(runWake));
    for (const result of results) {
      // Wait for every lease before allowing the scheduler to start its next tick.
      if (result.status === "rejected") throw result.reason;
      if (result.value) report[result.value]++;
    }
    return report;
  };
}
