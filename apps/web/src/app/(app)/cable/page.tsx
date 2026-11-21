import type { Metadata } from "next";

import { requireAddress } from "../owner";
import { LiveActivity } from "./live-activity";

export const metadata: Metadata = { title: "El cable · Nexo" };

export default async function CablePage() {
  const address = await requireAddress();
  return <LiveActivity key={address} />;
}
