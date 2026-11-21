import type { TelemetrySink } from "../types.js";
import { consoleSink, offSink, type ConsoleSinkOptions } from "./console.js";
import { postgresSink } from "./postgres.js";

/**
 * Elige el sink según TELEMETRY_SINK (postgres | console | off).
 * - postgres usa TELEMETRY_DATABASE_URL y, si falta, DATABASE_URL.
 * - Sin TELEMETRY_SINK: postgres si hay URL de base, si no console.
 * - postgres sin URL cae a console con un aviso: la telemetría nunca impide arrancar.
 */
export function sinkFromEnv(env: Record<string, string | undefined> = process.env, options?: ConsoleSinkOptions): TelemetrySink {
  const url = env.TELEMETRY_DATABASE_URL || env.DATABASE_URL;
  const mode = (env.TELEMETRY_SINK || (url ? "postgres" : "console")).toLowerCase();
  if (mode === "off") return offSink();
  if (mode === "postgres" && url) return postgresSink(url);
  if (mode === "postgres") {
    process.stderr.write("[telemetry] TELEMETRY_SINK=postgres sin TELEMETRY_DATABASE_URL ni DATABASE_URL; uso console.\n");
  } else if (mode !== "console") {
    process.stderr.write("[telemetry] TELEMETRY_SINK desconocido; uso console.\n");
  }
  return consoleSink(options);
}
