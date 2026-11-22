import { join } from "node:path";
import pg from "pg";
import { createOwnerRuntime, localReadTool } from "@team-31/broker-client";
import { LocalPart, RESULT_EVENT, WakeNotice } from "@team-31/protocol";
import { verifyWebhookSignature } from "@team-31/wake";
import { z } from "zod";
import { contactAddress, contactAgent, contactPrincipal, demoWakeSecret, getDemoTelemetry } from "./contact-broker.mjs";
import { askContactOwner } from "./contact-runtime.mjs";

const maxBytes = 2048;
const uuid = z.uuid();
const active = new Set();

async function readBody(request) {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function hasContactProfile(id) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requerida");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    const { rowCount } = await db.query("SELECT 1 FROM demo_profiles WHERE person_id = $1", [id]);
    return rowCount === 1;
  } finally {
    await db.end();
  }
}

function interestFile(root, id, { from, purpose }) {
  const directory = join(root, ".agents-local");
  if (from === contactAddress("ana") && purpose) {
    const match = /^demo-fixture:([0-9a-f-]{36})$/.exec(purpose);
    if (match && uuid.safeParse(match[1]).success) {
      return join(directory, "contact-sessions", match[1], id + ".json");
    }
  }
  return join(directory, id + "-interests.json");
}

async function answerNotice(route, id, { principal, tools }, notice, traceparent) {
  const key = route + "/" + id + "/" + notice.requestId;
  if (active.has(key)) return;
  active.add(key);
  const operation = route.replace("-", "_");
  try {
    await getDemoTelemetry().span("coordination.tool.call", {
      traceparent, userId: principal.userId, agentId: principal.agentId,
      requestId: notice.requestId, attrs: { tool: operation },
    }, () => createOwnerRuntime(contactAgent(), principal, tools)(notice));
  } catch (error) {
    getDemoTelemetry().error(`demo.${operation}.answer`, error, {
      userId: principal.userId, agentId: principal.agentId, requestId: notice.requestId,
    });
  } finally {
    active.delete(key);
  }
}

// Ana's contacts answer an interest_check by reading their private interest file.
export function handleContactWake(request, id, after, root) {
  return handleDemoWake(request, id, after, "contact-wake", async () => await hasContactProfile(id) && {
    principal: contactPrincipal(id),
    tools: [localReadTool("interest_check", ({ interest }, context) =>
      getDemoTelemetry().span("coordination.tool.call", { attrs: { tool: "check_interest" } },
        () => askContactOwner(interest, interestFile(root, id, context), root)))],
  });
}

// Verifies the broker's signed wake for a local demo identity and answers it after responding.
// `resolve` returns the identity's principal and read tools, or nothing for an unknown id.
export function handleDemoWake(request, id, after, route, resolve) {
  return getDemoTelemetry().span("http.request", {
    traceparent: request.headers.get("traceparent"),
    attrs: { method: "POST", route: `/api/demo/${route}/:id` },
  }, span => receive(request, id, after, route, resolve, span));
}

async function receive(request, id, after, route, resolve, span) {
  function finish(status, code, error) {
    span.set({ status, bucket: Math.floor(status / 100) + "xx" });
    getDemoTelemetry().emit("wake.attempt", {
      attrs: { kind: "standard_webhook", ok: status === 202, httpStatus: status, code },
    });
    const headers = new Headers({ "Cache-Control": "no-store", "X-Trace-Id": span.traceId });
    if (error) {
      const errorId = getDemoTelemetry().error(`demo.${route.replace("-", "_")}.receive`, error);
      span.setErrorId(errorId);
      headers.set("X-Error-Id", errorId);
    }
    return new Response(null, { status, headers });
  }

  const port = process.env.WEB_PORT;
  const host = request.headers.get("host");
  if (process.env.NODE_ENV !== "development" || !port ||
      (host !== "127.0.0.1:" + port && host !== "localhost:" + port) || !LocalPart.safeParse(id).success) {
    return finish(404, "route_unavailable");
  }

  try {
    const eventId = request.headers.get("webhook-id");
    const timestamp = request.headers.get("webhook-timestamp");
    const signature = request.headers.get("webhook-signature");
    if (!eventId || !signature || !/^\d+$/.test(timestamp ?? "") || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60) {
      return finish(401, "invalid_headers");
    }
    const body = await readBody(request);
    if (body === null) return finish(413, "body_too_large");
    if (!verifyWebhookSignature(demoWakeSecret(route, id), eventId, Number(timestamp), body, signature)) {
      return finish(401, "invalid_signature");
    }
    let notice;
    try {
      notice = WakeNotice.parse(JSON.parse(body));
    } catch (error) {
      return finish(400, "invalid_notice", error);
    }
    const closed = notice.event === RESULT_EVENT;
    if (!uuid.safeParse(notice.requestId).success || eventId !== (closed ? "evt_closed_" : "evt_") + notice.requestId) {
      return finish(400, "invalid_request_id");
    }

    const identity = await resolve();
    if (!identity) return finish(404, "unknown_contact");
    const { principal } = identity;
    getDemoTelemetry().identify({ userId: principal.userId, agentId: principal.agentId, requestId: notice.requestId });
    // Only the originating demo session can read its result via await_contact.
    if (closed) return finish(202, "accepted");
    const traceparent = getDemoTelemetry().traceparent();
    after(() => answerNotice(route, id, identity, notice, traceparent));
    return finish(202, "accepted");
  } catch (error) {
    return finish(503, "unavailable", error);
  }
}
