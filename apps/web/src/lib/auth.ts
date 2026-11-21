import "server-only";

import { createAuth } from "@team-31/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthOptions } from "./auth-env.mjs";

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (auth ??= createAuth(getAuthOptions()));
}

export async function getSession() {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
