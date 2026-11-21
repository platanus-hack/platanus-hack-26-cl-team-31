import type { Instrumentation } from "next";

// Starts the web telemetry when the server boots (service.started and the heartbeat), not on the
// first request. Only in the Node runtime: the sink uses pg and AsyncLocalStorage.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getTelemetry } = await import("./lib/telemetry");
  getTelemetry();
}

// Errors that escape server components, actions and route handlers: recorded without their
// message, with the route pattern as the operation.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getTelemetry } = await import("./lib/telemetry");
  getTelemetry().error(`${request.method} ${context.routePath}`, error);
};
