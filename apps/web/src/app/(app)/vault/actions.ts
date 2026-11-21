"use server";

import { VaultChange } from "@team-31/protocol";
import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/broker";
import { getOwner } from "../owner";

export async function changeVault(form: FormData) {
  const owner = await getOwner();
  const data = Object.fromEntries([...form.entries()].filter(([key]) => !key.startsWith("$ACTION_")));
  const { kind, ...fields } = data;
  const input = fields.action === "set_group" ? { ...fields, allowed: fields.allowed === "true" } :
    fields.action === "put_entry" ? { ...fields, value: kind === "number" ? (String(fields.value).trim() ? Number(fields.value) : NaN) :
      fields.value } : fields;
  const change = VaultChange.safeParse(input);
  if (!change.success) throw new Error("Revisa el nombre, el tipo y el valor del dato.");
  await ownerClient().changeVault(owner, change.data);
  revalidatePath("/vault");
}
