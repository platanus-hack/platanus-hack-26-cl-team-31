import { resolve } from "node:path";
import { handleCastWake } from "@team-31/demo/cast-wake";
import { after } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCastWake(request, id, after, resolve(process.cwd(), "../.."));
}
