import { WAKE_EVENT, type WakeResult } from "@team-31/protocol";
import type { BrokerDeps, TickReport } from "../ports.js";
import type { AgentConnectionRow, RequestRow, StoreTx, WakeJob } from "../store/store.js";

const batchSize = 100;

function actionable(row: RequestRow | null, job: WakeJob, now: Date): row is RequestRow {
  return row?.status === "awaiting_agent" && row.version === job.requestVersion && row.expiresAt > now;
}

async function recipient(tx: StoreTx, row: RequestRow): Promise<AgentConnectionRow | undefined> {
  if (!row.toUserId) return undefined;
  if (row.targetAgentId) {
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

export function createWorker({ store, waker, config }: BrokerDeps, closePending: ClosePending) {
  async function runWake(job: WakeJob, now: Date) {
    const target = await store.tx(async (tx) => {
      const row = await tx.getRequest(job.requestId);
      if (!actionable(row, job, now)) return;
      return recipient(tx, row);
    });
    let result: WakeResult = { ok: true, retryable: false, ms: 0 };
    const tried = target && target.wakeTarget.kind !== "none";
    if (tried) {
      try {
        const { ok, retryable, ms, status } = await waker.wake(target.wakeTarget, {
          requestId: job.requestId, event: WAKE_EVENT,
        });
        // Adapters may return diagnostic text. Persist only structured metadata.
        result = { ok, retryable, ms, status };
      } catch {
        result = { ok: false, retryable: true, ms: 0 };
      }
    }

    return store.tx(async (tx): Promise<"wakesOk" | "wakesRetried" | "wakesFailed" | undefined> => {
      if (tried) {
        const agent = await tx.getAgentConnection(target.userId, target.agentId, true);
        if (agent && (!agent.lastWakeAt || agent.lastWakeAt < now)) {
          await tx.upsertAgentConnection({ ...agent, lastWakeAt: now });
        }
      }
      const row = await tx.getRequest(job.requestId);
      if (!actionable(row, job, now)) {
        await tx.completeWake(job.id, result, null);
        return;
      }
      await tx.appendEvent({ requestId: row.id, at: now, kind: "wake", code: result.ok ? "ok" : "failed" });
      if (result.ok) {
        await tx.completeWake(job.id, result, null);
        return "wakesOk";
      }
      const delay = config.wakeRetryDelaysMs[job.attempt];
      if (result.retryable && delay !== undefined) {
        await tx.completeWake(job.id, result, new Date(now.getTime() + delay));
        return "wakesRetried";
      }
      await tx.completeWake(job.id, result, null);
      return await closePending(tx, row, "delivery_failed", now) ? "wakesFailed" : undefined;
    });
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

    const jobs = await store.tx((tx) => tx.claimDueWakes(now, batchSize));
    const results = await Promise.all(jobs.map((job) => runWake(job, now)));
    for (const result of results) {
      if (result) report[result]++;
    }
    return report;
  };
}
