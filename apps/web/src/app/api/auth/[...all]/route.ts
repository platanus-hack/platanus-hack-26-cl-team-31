import { getAuth } from "@/lib/auth";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
