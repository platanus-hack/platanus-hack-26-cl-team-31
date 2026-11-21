"use server";

import { VaultChange } from "@team-31/protocol";
import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/broker";
import { actionError, type Feedback } from "../action-feedback";
import { getOwner } from "../owner";

function parse(form: FormData) {
  const data = Object.fromEntries([...form.entries()].filter(([key]) => !key.startsWith("$ACTION_")));
  const { kind, ...fields } = data;
  if (fields.action === "set_tag") return VaultChange.safeParse({ ...fields, allowed: fields.allowed === "true" });
  if (fields.action !== "put_entry") return VaultChange.safeParse(fields);
  const raw = String(fields.value ?? "").trim();
  const numeric = kind === "number" || (kind === "auto" && raw !== "" && /^-?\d+([.,]\d+)?$/.test(raw));
  return VaultChange.safeParse({ ...fields, value: numeric ? Number(raw.replace(",", ".")) : fields.value });
}

export async function changeVault(form: FormData): Promise<Feedback> {
  const owner = await getOwner();
  const change = parse(form);
  if (!change.success) return { error: "Revisa el nombre y el valor." };
  try {
    await ownerClient().changeVault(owner, change.data);
  } catch (error) {
    return actionError("changeVault", error, "No se pudo guardar. Intenta de nuevo.");
  }
  revalidatePath("/vault");
  return { message: "Guardado." };
}
