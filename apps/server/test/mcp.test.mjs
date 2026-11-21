import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("coordination MCP returns structured objects and rejects a malformed success body", async (t) => {
  let result = { contacts: [] };
  let status = 200;
  let errorId;
  const api = createServer((_request, response) => {
    if (errorId) response.setHeader("X-Error-Id", errorId);
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(result));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => new Promise((done) => api.close(done)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/mcp.js", import.meta.url))],
    env: { COORDINATION_API_URL: `http://127.0.0.1:${api.address().port}`, AGENT_TOKEN: "fixture" },
  });
  const client = new Client({ name: "coordination-test", version: "1" });
  await client.connect(transport);
  t.after(() => client.close());
  const call = () => client.callTool({ name: "list_contacts", arguments: {} });
  assert.deepEqual((await call()).structuredContent, result);
  result = [];
  const invalid = await call();
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent, undefined);

  status = 400;
  errorId = "41b57d0b-e922-4c09-b67c-8be143fa2ffa";
  const failure = await call();
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.error.errorId, errorId);
  assert.ok(failure.content[0].text.includes(errorId));
  for (errorId of [undefined, "invalid"]) {
    const untraced = await call();
    assert.equal(untraced.structuredContent, undefined);
    assert.equal(untraced.content[0].text, "Coordinación HTTP 400");
  }
});
