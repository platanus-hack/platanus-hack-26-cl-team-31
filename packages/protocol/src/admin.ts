import { z } from "zod";

// Operator of the admin panel, as asserted by the admin server's service JWT (`sub` and `email`).
export const AdminActor = z.object({
  adminId: z.string().trim().min(1),
  email: z.email(),
});
export type AdminActor = z.infer<typeof AdminActor>;

// Every admin mutation carries a reason. The admin server keeps it in `admin.audit`.
export const AdminReason = z.string().trim().min(10).max(500);

export const AdminActionInput = z.object({ reason: AdminReason });
export type AdminActionInput = z.infer<typeof AdminActionInput>;
