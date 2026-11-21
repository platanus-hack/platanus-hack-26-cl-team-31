import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorBody, ReplyReceipt, RequesterView, WAKE_EVENT, type AskInput, type ReplyInput } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { z } from "zod";

const subscriptionSchema = z.object({ id: z.string(), refreshBefore: z.iso.datetime() });

export async function connectAgent(url: URL, token: string) {
  const client = new Client({ name: "nexo-e2e", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
  });

  try {
    await client.connect(transport);
  } catch {
    await client.close();
    throw new Error("No se pudo iniciar MCP. Verifica la URL y la autenticación del agente de prueba.");
  }

  async function call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
    if (response.isError) {
      const { error } = ErrorBody.parse(response.structuredContent);
      throw Object.assign(new Error(error.message), { code: error.code });
    }
    const result = schema.parse(response.structuredContent);
    assert.deepEqual(response.structuredContent, result, `${name} devolvió campos fuera del contrato.`);
    return result;
  }

  return {
    ask: (input: AskInput) => call("nexo_ask", input, RequesterView),
    inbox: async () => (await call("nexo_inbox", {}, routes.agentInbox.response)).items,
    reply: (input: ReplyInput) => call("nexo_reply", input, ReplyReceipt),
    check: (requestId: string) => call("nexo_check", { requestId }, RequesterView),
    subscribe: (url: string, secret: string) => client.request({
      method: "events/subscribe",
      params: { name: WAKE_EVENT, delivery: { mode: "webhook", url, secret } },
    }, subscriptionSchema),
    unsubscribe: (id: string) => client.request({ method: "events/unsubscribe", params: { id } }, z.object({})),
    close: () => client.close(),
  };
}
