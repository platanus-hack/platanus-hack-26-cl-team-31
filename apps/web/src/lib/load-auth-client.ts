"use client";

// Better Auth's client weighs ~14 KB gzip and only runs when a button is pressed. Buttons load it
// through this function after hydration instead of importing it, keeping it off the critical path.
export function loadAuthClient() {
  return import("./auth-client").then((module) => module.authClient);
}
