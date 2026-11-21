import {
  consoleSink,
  createTelemetry,
  offSink,
  sinkFromEnv,
  type Telemetry,
  type TelemetrySink,
} from "@team-31/telemetry";

/**
 * Same choice as sinkFromEnv (TELEMETRY_SINK, TELEMETRY_DATABASE_URL or DATABASE_URL), except
 * that in stdio mode stdout carries MCP: the console sink writes to stderr instead.
 */
export function mcpSink(stdio: boolean, env: Record<string, string | undefined> = process.env): TelemetrySink {
  const url = env.TELEMETRY_DATABASE_URL || env.DATABASE_URL;
  const mode = (env.TELEMETRY_SINK || (url ? "postgres" : "console")).toLowerCase();
  if (stdio && mode === "console") return consoleSink({ stream: process.stderr });
  if (stdio && mode === "postgres" && !url) return consoleSink({ stream: process.stderr });
  return sinkFromEnv(env);
}

export function createMcpTelemetry(stdio: boolean): Telemetry {
  return createTelemetry({ service: "mcp", version: process.env.npm_package_version, sink: mcpSink(stdio) });
}

/** For tests and embedded uses without telemetry. */
export function silentTelemetry(): Telemetry {
  return createTelemetry({ service: "mcp", sink: offSink(), heartbeatMs: 0, lifecycle: false });
}
