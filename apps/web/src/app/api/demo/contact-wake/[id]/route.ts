import { resolve } from "node:path";
import { handleContactWake } from "@team-31/demo/contact-wake";
import { after } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleContactWake(request, id, after, resolve(process.cwd(), "../.."));
}
