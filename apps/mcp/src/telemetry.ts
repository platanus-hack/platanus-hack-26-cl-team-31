import {
  createTelemetry,
  sinkFromEnv,
  type Telemetry,
  type TelemetrySink,
} from "@team-31/telemetry";

/**
 * Same choice as sinkFromEnv (TELEMETRY_SINK, TELEMETRY_DATABASE_URL or DATABASE_URL), except
 * that in stdio mode stdout carries MCP: the console sink writes to stderr instead.
 */
export function mcpSink(stdio: boolean, env: Record<string, string | undefined> = process.env): TelemetrySink {
  return sinkFromEnv(env, stdio ? { stream: process.stderr } : undefined);
}

export function createMcpTelemetry(stdio: boolean): Telemetry {
  return createTelemetry({ service: "mcp", version: process.env.npm_package_version, sink: mcpSink(stdio) });
}
