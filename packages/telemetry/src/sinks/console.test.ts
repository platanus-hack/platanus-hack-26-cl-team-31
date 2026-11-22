import { expect, it } from "vitest";
import { createTelemetry } from "../telemetry.js";
import { consoleSink } from "./console.js";

it("cuenta como fallido el evento que el stream de consola rechaza al escribir", () => {
  const stream = {
    write() { throw new Error("stream cerrado"); },
  };
  const telemetry = createTelemetry({ service: "broker", sink: consoleSink({ stream }), lifecycle: false });

  telemetry.emit("service.started", { attrs: { version: "test" } });

  expect(telemetry.stats()).toMatchObject({ failed: 1, written: 0 });
});
