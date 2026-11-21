import { ActivityItem } from "@team-31/protocol";

// The sent branch of ActivityItem strips private reasons and unknown fields.
export function parseActivity(data: string): ActivityItem | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return undefined;
  }
  return ActivityItem.safeParse(payload).data;
}
