import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Only "/": visitors without a session cookie see the public landing (/bienvenida) under the same
// URL. This is an optimistic routing hint, not authentication: the (app) layout still validates the
// session and sends an expired cookie to /sign-in exactly as before. Every other route skips this.
export function proxy(request: NextRequest) {
  if (process.env.UI_FROZEN === "1" || getSessionCookie(request)) return NextResponse.next();
  const response = NextResponse.rewrite(new URL("/bienvenida", request.url));
  // "/" answers differently with and without a session: keep shared caches from storing the landing.
  response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
  return response;
}

export const config = { matcher: "/" };
