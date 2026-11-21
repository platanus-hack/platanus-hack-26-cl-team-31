import "server-only";

import { createAuth } from "@team-31/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuthOptions } from "./auth-env.mjs";

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (auth ??= createAuth(getAuthOptions()));
}

// One lookup per server render: layouts, pages and helpers of the same request share it.
// Outside a render (route handlers, actions) React's cache does not memoize and each call reads again.
export const getSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
