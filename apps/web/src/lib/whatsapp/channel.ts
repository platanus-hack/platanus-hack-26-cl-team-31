import type { WakeTarget } from "@team-31/protocol";
import { noticeTarget } from "./kapso";
import { ownerClient } from "../broker";
import { getTelemetry } from "../telemetry";

// The broker notifies the channel when a WhatsApp request changes. Linking and asking still work if
// this fails: the owner can read replies with «estado».
export async function setChannel(userId: string, target: WakeTarget) {
  try {
    await ownerClient().setChannel({ userId }, "whatsapp", target);
    return true;
  } catch (error) {
    getTelemetry().error("whatsapp.channel", error, { userId });
    return false;
  }
}

export async function registerNoticeChannel(userId: string, linkId: string) {
  const target = noticeTarget(linkId);
  return target ? setChannel(userId, target) : false;
}
