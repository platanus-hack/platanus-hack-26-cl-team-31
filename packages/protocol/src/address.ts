import { z } from "zod";

const localPartPattern = "[a-z0-9][a-z0-9._-]{1,30}";

export const LocalPart = z.string().regex(new RegExp(`^${localPartPattern}$`));

export const Address = z.string().regex(
  new RegExp(`^${localPartPattern}@[a-z0-9.-]+\\.[a-z]{2,}$`),
);
export type Address = z.infer<typeof Address>;
