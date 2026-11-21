import "server-only";
import { ownerClient } from "@/lib/broker";
import { readAsOwner } from "../owner";

const activityPageSize = 20;

function parseActivityPage(input: unknown) {
  if (typeof input !== "string" || !/^[1-9][0-9]*$/.test(input)) return 1;
  const value = Number(input);
  return Number.isSafeInteger(value * activityPageSize + 1) ? value : 1;
}

export async function readActivity(input: unknown) {
  const page = parseActivityPage(input);
  const last = page * activityPageSize;
  const { data: items } = await readAsOwner((owner) => ownerClient().activity(owner, last + 1));
  return { page, items: items.slice(last - activityPageSize, last), hasNext: items.length > last };
}
