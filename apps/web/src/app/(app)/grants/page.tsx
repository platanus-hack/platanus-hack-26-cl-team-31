import { Suspense } from "react";

import { readGrants } from "../actions";
import { Heading } from "../ui";
import { GrantsEditor } from "./grants-editor";

async function FriendPermissions() {
  return <GrantsEditor grants={await readGrants()} />;
}

export default function GrantsPage() {
  return (
    <div className="max-w-4xl">
      <Heading title="Amigos y permisos">Elige qué puede preguntarte cada amigo a través de su agente y qué datos tuyos puede recibir.</Heading>
      <Suspense fallback={<p role="status">Cargando permisos…</p>}>
        <FriendPermissions />
      </Suspense>
    </div>
  );
}
