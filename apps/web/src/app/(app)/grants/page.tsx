import { Address } from "@team-31/protocol";
import { Suspense } from "react";

import { readGrants } from "../actions";
import { Heading } from "../ui";
import { GrantsEditor } from "./grants-editor";

async function FriendPermissions({ searchParams }: PageProps<"/grants">) {
  const [grants, params] = await Promise.all([readGrants(), searchParams]);
  const address = Address.safeParse(params.to).data ?? "";
  return <GrantsEditor key={address} grants={grants} initialAddress={address} />;
}

export default function GrantsPage(props: PageProps<"/grants">) {
  return (
    <div className="max-w-4xl">
      <Heading title="Permisos">Elige qué puede preguntarte cada persona a través de su agente y qué datos tuyos puede recibir.</Heading>
      <Suspense fallback={<p role="status">Cargando permisos…</p>}>
        <FriendPermissions {...props} />
      </Suspense>
    </div>
  );
}
