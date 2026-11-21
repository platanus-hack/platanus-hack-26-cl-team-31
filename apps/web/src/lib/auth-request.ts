import "server-only";

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { createAuthServerMetadata } from "@team-31/auth/server";
import { connection } from "next/server";

import { getAuth } from "./auth";

export async function authServerMetadata(request: Request) {
  await connection();
  return createAuthServerMetadata(getAuth())(request);
}

type SearchParams = Record<string, string | string[] | undefined>;

export async function getOAuthRequest(params: SearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of typeof value === "string" ? [value] : value ?? []) {
      query.append(key, entry);
    }
  }

  const clientId = query.get("client_id");
  if (!clientId || !query.has("sig")) return null;

  const signedQuery = query.toString();
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(signedQuery, secret))) return null;

  const scopes = [...new Set((query.get("scope") ?? "").split(" ").filter(Boolean))];
  return { clientId, signedQuery, scopes };
}
