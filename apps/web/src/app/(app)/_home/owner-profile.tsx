import type { ReactNode } from "react";

import { getOwnerAccount } from "@/lib/auth-owner";

import { card, Stamp, textLink } from "../ui";

function ProfileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row" className="w-2/5 px-4 py-3 align-top font-medium text-muted sm:w-48 sm:px-5">{label}</th>
      <td className="px-4 py-3 align-top [overflow-wrap:anywhere] sm:px-5">{children}</td>
    </tr>
  );
}

export async function OwnerProfile() {
  const { user, address, displayName } = await getOwnerAccount();
  const photo = user.image && /^https:\/\//i.test(user.image)
    ? <a className={textLink} href={user.image} referrerPolicy="no-referrer">Ver foto de perfil</a>
    : "Sin foto";

  return (
    <section aria-labelledby="profile-title">
      <h2 id="profile-title" className="sr-only">Mi perfil</h2>
      <div className={card}>
        <table aria-labelledby="profile-title" className="w-full table-fixed text-left text-sm">
          <tbody className="divide-y divide-line">
            <ProfileRow label="Nombre">{user.name || "Sin nombre"}</ProfileRow>
            {displayName && displayName !== user.name && <ProfileRow label="Nombre en Sideband">{displayName}</ProfileRow>}
            <ProfileRow label="Dirección Sideband">{address}</ProfileRow>
            <ProfileRow label="Correo">
              {user.email} <span className="text-muted">({user.emailVerified ? "verificado" : "sin verificar"})</span>
            </ProfileRow>
            <ProfileRow label="Foto de perfil">{photo}</ProfileRow>
            <ProfileRow label="Fecha de registro"><Stamp value={new Date(user.createdAt).toISOString()} /></ProfileRow>
          </tbody>
        </table>
      </div>
    </section>
  );
}
