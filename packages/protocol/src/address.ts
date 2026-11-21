import { z } from "zod";

export { ADDRESS_DOMAIN } from "./constants.js";

const localPartPattern = "[a-z0-9][a-z0-9._-]{1,30}";

export const LocalPart = z.string().regex(new RegExp(`^${localPartPattern}$`));

export const Address = z.string().regex(
  new RegExp(`^${localPartPattern}@[a-z0-9.-]+\\.[a-z]{2,}$`),
);
export type Address = z.infer<typeof Address>;

export const systemLocalPart = "system";
export function isSystemSender(address: Address): boolean {
  return address.startsWith(systemLocalPart + "@");
}
