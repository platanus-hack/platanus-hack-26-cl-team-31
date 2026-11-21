import { WAKE_EVENT, type WakeResult } from "@team-31/protocol";
import type { BrokerDeps, TickReport } from "../ports.js";
import type { AgentConnectionRow, RequestRow, StoreTx, WakeClaim, WakeJob } from "../store/store.js";

const batchSize = 100;
const wakeLeaseMs = 60_000;

function actionable(row: RequestRow | null, job: WakeJob, now: Date): row is RequestRow {
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

type ClosePending = (tx: StoreTx, row: RequestRow, status: "expired" | "delivery_failed", at: Date) => Promise<boolean>;
type WorkerDeps = Pick<BrokerDeps, "store" | "waker" | "clock" | "telemetry"> & { wakeRetryDelaysMs: readonly number[] };

export function createWorker({ store, waker, clock, telemetry, wakeRetryDelaysMs }: WorkerDeps, closePending: ClosePending) {
  async function runWake(job: WakeClaim) {
    const candidate = await store.tx(async (tx) => {
      const row = await tx.getRequest(job.requestId);
      if (!actionable(row, job, clock.now())) return null;
      return { target: await recipient(tx, row), expiresAt: row.expiresAt, userId: row.toUserId };
    });
    const now = clock.now();
    if (job.runAt <= now) return;
    const target = candidate && candidate.expiresAt > now ? candidate.target : undefined;
    const fields = { requestId: job.requestId, userId: candidate?.userId, agentId: target?.agentId };
    if (job.recovered) telemetry?.emit("wake.lease_recovered", { ...fields, attrs: { attempt: job.attempt } });
    const exhausted = job.recovered && job.attempt > Math.max(1, wakeRetryDelaysMs.length);
    let result: WakeResult = { ok: true, retryable: false, ms: 0 };
    let tried = false;
    if (target && target.wakeTarget.kind !== "none") {
      if (exhausted) {
        result = { ok: false, retryable: false, ms: 0 };
      } else {
        tried = true;
        try {
          const { ok, retryable, ms, status } = await waker.wake(target.wakeTarget, {
            requestId: job.requestId, event: WAKE_EVENT,
          }, {
            attempt: job.attempt, final: wakeRetryDelaysMs[job.attempt] === undefined,
            userId: target.userId, agentId: target.agentId,
          });
          // Adapters may return diagnostic text. Persist only structured metadata.
          result = { ok, retryable, ms, status };
        } catch (error) {
          telemetry?.error?.("wake.deliver", error, fields);
          result = { ok: false, retryable: true, ms: 0 };
        }
      }
    }

    const outcome = await store.tx(async (tx): Promise<"wakesOk" | "wakesRetried" | "wakesFailed" | undefined> => {
      const current = await tx.getWakeForUpdate(job.requestId, job.requestVersion);
      if (current?.id !== job.id || current.attempt !== job.attempt || current.state !== "running") return;
      // Reply processing also locks the agent before changing the request.
      const agent = tried && target ? await tx.getAgentConnection(target.userId, target.agentId, true) : null;
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
    let expiredBatchSize: number;
    do {
      expiredBatchSize = await store.tx(async (tx) => {
        const due = await tx.listDueForExpiry(now, batchSize);
        for (const row of due) {
          if (await closePending(tx, row, "expired", now)) report.expired++;
        }
        return due.length;
      });
    } while (expiredBatchSize === batchSize);

    const claimAt = clock.now();
    const leaseUntil = new Date(claimAt.getTime() + wakeLeaseMs);
    const jobs = await store.tx((tx) => tx.claimDueWakes(claimAt, leaseUntil, batchSize));
    const results = await Promise.all(jobs.map(runWake));
    for (const result of results) {
      if (result) report[result]++;
    }
    return report;
  };
}
