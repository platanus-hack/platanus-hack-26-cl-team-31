import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import {
  ErrorCode,
  WakeVerificationReason,
  httpStatusOf,
  type Owner,
  type Principal,
  type ReplyInput,
} from "@team-31/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { BrokerError, createAgentClient, createOwnerClient } from "./index.js";

type Request = {
  method: string;
  path: string;
  authorization?: string;
  contentType?: string;
  body?: unknown;
};

const principal: Principal = { userId: "alice", agentId: "agent-alice", scopes: ["sideband:ask"] };
const owner: Owner = { userId: "alice" };
const expiresAt = "2026-11-21T18:00:00Z";
const requestId = "request/one?detail#here %✓";
const encodedId = "request%2Fone%3Fdetail%23here%20%25%E2%9C%93";
const askInput = { to: "bob@sideband.app", tool: "question", args: { text: "¿Puedes ayudar?", category: "general" } } as const;
const requesterView = {
  requestId,
  to: askInput.to,
  tool: askInput.tool,
  expiresAt,
  final: false,
  decision: "pending",
  waitingFor: "agent",
};
const replyInput = { requestId, nonce: "nonce", outcome: "no_data" } as const;
const receipt = { requestId, status: "no_data", deliveredFields: [], droppedFields: [] };
const target = { kind: "none" } as const;
const connection = { agentId: "agent-alice", label: "Dot", createdAt: expiresAt, wakeKind: "none" };
const ownerInfo = { userId: owner.userId, address: "alice@sideband.app", displayName: "Alice" };

let stopServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await stopServer?.();
  stopServer = undefined;
});

function send(response: ServerResponse, status: number, payload?: unknown) {
  if (payload === undefined) {
    response.writeHead(status).end();
  } else {
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  }
}

async function broker(
  respond: (response: ServerResponse, count: number) => void,
) {
  const requests: Request[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body: rawBody ? JSON.parse(rawBody) : undefined,
      });
      respond(response, requests.length);
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  stopServer = () =>
    new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto del servidor de prueba.");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const getAgentToken = vi.fn(async (_identity: Principal) => `agent-token-${getAgentToken.mock.calls.length}`);
  const getOwnerToken = vi.fn(async (_identity: Owner) => `owner-token-${getOwnerToken.mock.calls.length}`);
  return {
    requests,
    getAgentToken,
    getOwnerToken,
    agent: createAgentClient({ baseUrl, getServiceToken: getAgentToken }),
    ownerClient: createOwnerClient({ baseUrl, getServiceToken: getOwnerToken }),
  };
}

it("accepts a question without a category on either ask port", async () => {
  const { agent, ownerClient, requests } = await broker((response) => send(response, 200, requesterView));
  const input = { ...askInput, args: { text: askInput.args.text } };
  await ownerClient.ask(owner, input);
  await agent.ask(principal, input);
  expect(requests.map(({ body }) => body)).toEqual([askInput, askInput]);
});

it("implements the agent port over the contracted HTTP routes", async () => {
  const inboxItem = {
    requestId,
    nonce: replyInput.nonce,
    tool: "question",
    from: ownerInfo.address,
    args: askInput.args,
    expiresAt,
    allowedFields: ["answer"],
    ownerAuthorization: { rule: "amigos", guidance: "", verifiedBy: "broker" },
    senderMessage: { text: askInput.args.text, trusted: false },
    howToReply: "Responde con sideband_reply.",
  };
  const replies = [requesterView, { items: [inboxItem] }, receipt, requesterView, connection];
  const { agent, requests, getAgentToken } = await broker((response, count) => {
    send(response, count === 6 ? 204 : 200, replies[count - 1]);
  });

  const inputWithIdentity = { ...askInput, userId: "another-user" };
  expect(await agent.ask(principal, inputWithIdentity)).toEqual(requesterView);
  expect(await agent.inbox(principal)).toEqual([inboxItem]);
  expect(await agent.reply(principal, replyInput)).toEqual(receipt);
  expect(await agent.status(principal, requestId)).toEqual(requesterView);
  expect(await agent.connectWake(principal, target)).toEqual(connection);
  expect(await agent.disconnectWake(principal, requestId)).toBeUndefined();

  expect(requests.map(({ method, path, body }) => [method, path, body])).toEqual([
    ["POST", "/v1/agent/ask", askInput],
    ["GET", "/v1/agent/inbox", undefined],
    ["POST", "/v1/agent/reply", replyInput],
    ["GET", `/v1/agent/requests/${encodedId}`, undefined],
    ["POST", "/v1/agent/wake", target],
    ["DELETE", `/v1/agent/wake/${encodedId}`, undefined],
  ]);
  expect(requests.map((request) => request.authorization)).toEqual([
    "Bearer agent-token-1",
    "Bearer agent-token-2",
    "Bearer agent-token-3",
    "Bearer agent-token-4",
    "Bearer agent-token-5",
    "Bearer agent-token-6",
  ]);
  expect(getAgentToken.mock.calls).toEqual(Array.from({ length: 6 }, () => [principal]));
  expect(requests[0]?.contentType).toBe("application/json");
  expect(requests[1]?.contentType).toBeUndefined();
});

it("implements the owner port, including optional queries, wrapper responses and 204s", async () => {
  const pending = {
    requestId,
    from: askInput.to,
    tool: "question",
    args: askInput.args,
    senderMessage: { text: askInput.args.text, trusted: false },
    expiresAt,
  };
  const activity = {
    requestId,
    direction: "sent",
    from: ownerInfo.address,
    to: askInput.to,
    tool: "question",
    status: "awaiting_owner",
    createdAt: expiresAt,
    expiresAt,
    events: [],
  };
  const grantInput = { grantee: askInput.to, category: "general" } as const;
  const grant = { ...grantInput, id: requestId, createdAt: expiresAt };
  const replies = [
    ownerInfo, { address: ownerInfo.address }, { items: [grant] }, grant, undefined,
    { items: [pending] }, { items: [activity] }, { items: [] }, { items: [activity] }, undefined,
    { items: [connection] }, undefined, { requestId }, undefined,
  ];
  const { ownerClient, requests, getOwnerToken } = await broker((response, count) => {
    const reply = replies[count - 1];
    send(response, reply === undefined ? 204 : 200, reply);
  });
  const decision = { kind: "approve_once" } as const;

  expect(await ownerClient.me(owner)).toEqual(ownerInfo);
  expect(await ownerClient.claimAddress(owner, "alice")).toBe(ownerInfo.address);
  expect(await ownerClient.grants(owner)).toEqual([grant]);
  expect(await ownerClient.setGrant(owner, grantInput)).toEqual(grant);
  expect(await ownerClient.revokeGrant(owner, requestId)).toBeUndefined();
  expect(await ownerClient.pending(owner)).toEqual([pending]);
  expect(await ownerClient.activity(owner, 3)).toEqual([activity]);
  expect(await ownerClient.activity(owner)).toEqual([]);
  expect(await ownerClient.activity(owner, { requestId })).toEqual([activity]);
  expect(await ownerClient.decide(owner, requestId, decision)).toBeUndefined();
  expect(await ownerClient.agents(owner)).toEqual([connection]);
  expect(await ownerClient.setWake(owner, requestId, target)).toBeUndefined();
  expect(await ownerClient.ping(owner, requestId)).toEqual({ requestId });
  expect(await ownerClient.revokeAgent(owner, requestId)).toBeUndefined();

  expect(requests.map(({ method, path, body }) => [method, path, body])).toEqual([
    ["GET", "/v1/owner/me", undefined],
    ["POST", "/v1/owner/address", { localPart: "alice" }],
    ["GET", "/v1/owner/grants", undefined],
    ["PUT", "/v1/owner/grants", grantInput],
    ["DELETE", `/v1/owner/grants/${encodedId}`, undefined],
    ["GET", "/v1/owner/pending", undefined],
    ["GET", "/v1/owner/activity?limit=3", undefined],
    ["GET", "/v1/owner/activity", undefined],
    ["GET", `/v1/owner/activity?${new URLSearchParams({ requestId })}`, undefined],
    ["POST", `/v1/owner/requests/${encodedId}/decision`, decision],
    ["GET", "/v1/owner/agents", undefined],
    ["PUT", `/v1/owner/agents/${encodedId}/wake`, target],
    ["POST", `/v1/owner/agents/${encodedId}/ping`, undefined],
    ["DELETE", `/v1/owner/agents/${encodedId}`, undefined],
  ]);
  expect(requests.map((request) => request.authorization)).toEqual(
    Array.from({ length: replies.length }, (_, index) => `Bearer owner-token-${index + 1}`),
  );
  expect(getOwnerToken.mock.calls).toEqual(Array.from({ length: replies.length }, () => [owner]));
});

// La asimetría es el diseño: invalid_input habla del payload del propio llamador, las demás
// denegaciones hablan del estado de otras personas y deben ser indistinguibles entre sí.
it.each(ErrorCode.options.filter((code) => code !== "invalid_input"))(
  "returns BrokerError(%s) without upstream text",
  async (code) => {
    const { ownerClient, requests } = await broker((response) => {
      send(response, httpStatusOf(code), { error: { code, message: "owner-token-1" } });
    });

    const result = ownerClient.me(owner);
    await expect(result).rejects.toBeInstanceOf(BrokerError);
    await expect(result).rejects.toMatchObject({ code });
    await expect(result).rejects.not.toThrow("owner-token-1");
    expect(requests).toHaveLength(1);
  },
);

it("keeps the specific reason the broker gave for invalid_input", async () => {
  const message = "La respuesta no cumple el formato requerido. Revisa: result.";
  const { ownerClient } = await broker((response) => {
    send(response, 400, { error: { code: "invalid_input", message } });
  });

  await expect(ownerClient.me(owner)).rejects.toMatchObject({ code: "invalid_input", message });
});

it("caps an oversized invalid_input reason instead of forwarding it whole", async () => {
  const { ownerClient } = await broker((response) => {
    send(response, 400, { error: { code: "invalid_input", message: "x".repeat(5_000) } });
  });

  await expect(ownerClient.me(owner)).rejects.toSatisfy(
    (error: BrokerError) => error.code === "invalid_input" && error.message.length <= 300,
  );
});

it("preserves an upstream error ID even when a response body cannot be decoded", async () => {
  const errorId = randomUUID();
  const { ownerClient } = await broker((response, count) => {
    response.setHeader("X-Error-Id", count === 1 ? errorId : "unexpected-upstream-value");
    response.writeHead(500).end("invalid JSON");
  });

  await expect(ownerClient.me(owner)).rejects.toMatchObject({
    code: "internal", stage: "decoding", errorId,
  });
  await expect(ownerClient.me(owner)).rejects.toMatchObject({
    code: "internal", stage: "decoding", errorId: undefined,
  });
});

it.each(WakeVerificationReason.options)(
  "preserves the wake verification reason %s",
  async (reason) => {
    const { agent } = await broker((response) => {
      send(response, 400, { error: { code: "invalid_input", reason, message: "raw upstream message" } });
    });
    await expect(agent.connectWake(principal, target)).rejects.toMatchObject({
      code: "invalid_input",
      reason,
      message: reason,
    });
  },
);

it("does not infer a callback reason from a generic error message", async () => {
  const { agent } = await broker((response) => {
    send(response, 400, { error: { code: "invalid_input", message: "challenge_failed" } });
  });
  await expect(agent.connectWake(principal, target)).rejects.toMatchObject({
    code: "invalid_input", reason: undefined,
  });
});

it("rejects invalid bodies, query values and path segments before signing or sending", async () => {
  const { agent, ownerClient, requests, getAgentToken, getOwnerToken } = await broker((response) => {
    send(response, 500);
  });

  await expect(agent.ask(principal, { ...askInput, to: "invalid" })).rejects.toMatchObject({
    code: "invalid_input", message: expect.stringMatching(/Revisa: to\b/),
  });
  await expect(agent.reply(principal, { ...replyInput, outcome: "answered", result: () => "invalid" }))
    .rejects.toMatchObject({ code: "invalid_input" });
  const missingResult = { ...replyInput, outcome: "answered" } as unknown as ReplyInput;
  await expect(agent.reply(principal, missingResult)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(ownerClient.activity(owner, 0)).rejects.toMatchObject({
    code: "invalid_input", message: expect.stringMatching(/Revisa: limit\b/),
  });
  await expect(ownerClient.revokeAgent(owner, "..")).rejects.toMatchObject({ code: "invalid_input" });
  expect(requests).toEqual([]);
  expect(getAgentToken).not.toHaveBeenCalled();
  expect(getOwnerToken).not.toHaveBeenCalled();
});

it("returns an internal error for malformed success and error responses", async () => {
  const { agent, ownerClient } = await broker((response, count) => {
    if (count === 1) send(response, 200, { items: "unexpected" });
    if (count === 2) send(response, 500, { error: { code: "unexpected" } });
    if (count === 3) send(response, 200, null);
    if (count === 4) response.writeHead(200).end("invalid JSON");
  });

  await expect(agent.inbox(principal)).rejects.toMatchObject({ code: "internal" });
  await expect(ownerClient.me(owner)).rejects.toMatchObject({ code: "internal" });
  await expect(ownerClient.revokeAgent(owner, "agent")).rejects.toMatchObject({ code: "internal" });
  await expect(ownerClient.me(owner)).rejects.toMatchObject({ code: "internal" });
});

it.each([502, 503, 504])("retries GET once after %i with a freshly minted token", async (status) => {
  const { ownerClient, requests } = await broker((response, count) => {
    send(response, count === 1 ? status : 200, count === 1 ? "upstream error" : ownerInfo);
  });

  expect(await ownerClient.me(owner)).toEqual(ownerInfo);
  expect(requests.map((request) => request.authorization)).toEqual([
    "Bearer owner-token-1",
    "Bearer owner-token-2",
  ]);
});

it("stops after the first GET retry and never retries mutations", async () => {
  const { agent, ownerClient, requests } = await broker((response) => send(response, 503));

  await expect(ownerClient.me(owner)).rejects.toMatchObject({ code: "internal" });
  await expect(agent.ask(principal, askInput)).rejects.toMatchObject({ code: "internal" });
  await expect(ownerClient.setGrant(owner, { grantee: askInput.to, category: "general" }))
    .rejects.toMatchObject({ code: "internal" });
  await expect(ownerClient.revokeAgent(owner, "agent")).rejects.toMatchObject({ code: "internal" });
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PUT", "DELETE"]);
});

it("applies the ten-second deadline while reading a JSON response body", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementationOnce(() => timeout(200));
  const { ownerClient, requests } = await broker((response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"userId":');
  });

  await expect(ownerClient.me(owner)).rejects.toMatchObject({ code: "internal" });
  expect(deadline).toHaveBeenCalledExactlyOnceWith(10_000);
  expect(requests).toHaveLength(1);
});

it("sanitizes signer failures before sending the request", async () => {
  const { agent, getAgentToken, requests } = await broker((response) => send(response, 500));
  const cause = new Error("private signing material");
  getAgentToken.mockImplementationOnce(() => { throw cause; });

  const result = agent.inbox(principal);
  await expect(result).rejects.toMatchObject({ code: "internal", stage: "signing" });
  await expect(result).rejects.toSatisfy((error: BrokerError) => error.cause === cause);
  await expect(result).rejects.not.toThrow(cause.message);
  expect(getAgentToken).toHaveBeenCalledTimes(1);
  expect(requests).toEqual([]);
});

it("applies the deadline while obtaining the service token", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementationOnce(() => timeout(25));
  const { agent, getAgentToken, requests } = await broker((response) => send(response, 500));
  getAgentToken.mockReturnValueOnce(new Promise(() => {}));

  await expect(agent.inbox(principal)).rejects.toMatchObject({ code: "internal" });
  expect(getAgentToken).toHaveBeenCalledTimes(1);
  expect(requests).toEqual([]);
});
