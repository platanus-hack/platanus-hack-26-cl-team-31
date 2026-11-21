import { expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

it("tracks independent windows without extending them on rejection", () => {
  let time = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 2500, now: () => time });
  expect(limiter.consume("a")).toBeUndefined();
  expect(limiter.consume("a")).toEqual({ retryAfter: 3 });
  time = 2000;
  expect(limiter.consume("b")).toBeUndefined();
  expect(limiter.consume("a")).toEqual({ retryAfter: 1 });
  time = 2500;
  expect(limiter.consume("a")).toBeUndefined();
  expect(limiter.consume("b")).toEqual({ retryAfter: 2 });
});
