import type { ReactNode } from "react";

import { getOwnerAccount, getOwnerUser } from "@/lib/auth-owner";
import { getTelemetry } from "@/lib/telemetry";
import { whatsappStore } from "@/lib/whatsapp/runtime";

import { card, Stamp, textLink } from "../ui";

async function linkedPhone(userId: string) {
  try {
    const state = await whatsappStore().state(userId);
    return state?.linked ?? "Sin vincular";
  } catch (error) {
    const errorId = getTelemetry().error("profile whatsapp state", error);
    return `No disponible. Código de error ${errorId}.`;
  }
}

function ProfileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row" className="w-2/5 px-4 py-3 align-top font-medium text-muted sm:w-48 sm:px-5">{label}</th>
      <td className="px-4 py-3 align-top [overflow-wrap:anywhere] sm:px-5">{children}</td>
    </tr>
  );
}

export async function OwnerProfile() {
  // The phone only needs the session's user: read it alongside the broker's account lookup.
  const [{ user, address, displayName }, phone] = await Promise.all([
    getOwnerAccount(),
    getOwnerUser().then((user) => linkedPhone(user.id)),
  ]);
  const photo = user.image && /^https:\/\//i.test(user.image)
    ? <a className={textLink} href={user.image} referrerPolicy="no-referrer">Ver foto de perfil</a>
    : "Sin foto";

  return (
    <section aria-labelledby="profile-title" className="mt-8">
      <h2 id="profile-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Mi perfil</h2>
      <div className={card}>
        <table aria-labelledby="profile-title" className="w-full table-fixed text-left text-sm">
          <tbody className="divide-y divide-line">
            <ProfileRow label="Nombre">{user.name || "Sin nombre"}</ProfileRow>
            {displayName && displayName !== user.name && <ProfileRow label="Nombre en Sideband">{displayName}</ProfileRow>}
            <ProfileRow label="Dirección Sideband">{address}</ProfileRow>
            <ProfileRow label="Correo">
              {user.email} <span className="text-muted">({user.emailVerified ? "verificado" : "sin verificar"})</span>
            </ProfileRow>
            <ProfileRow label="WhatsApp">{phone}</ProfileRow>
            <ProfileRow label="Foto de perfil">{photo}</ProfileRow>
            <ProfileRow label="Fecha de registro"><Stamp value={new Date(user.createdAt).toISOString()} /></ProfileRow>
          </tbody>
        </table>
      </div>
    </section>
  );
}
