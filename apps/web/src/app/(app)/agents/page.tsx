import Link from "next/link";
import { Suspense } from "react";

import { button, Heading, ListSkeleton } from "../ui";
import { Segmented } from "../sliding";
import { AgentDirectory } from "./directory";
import { MyConnections } from "./my-connections";

async function AgentsView({ searchParams }: { searchParams: PageProps<"/agents">["searchParams"] }) {
  const { vista, q } = await searchParams;
  const personal = vista === "conexiones";
  const tabs = [
    { href: "/agents", label: "Directorio", active: !personal },
    { href: "/agents?vista=conexiones", label: "Mis conexiones", active: personal },
  ];
  return (
    <>
      <div className="mb-6"><Segmented label="Vistas de agentes" items={tabs.map(({ href, label, active }) => ({ key: href, href, label, active }))} /></div>
      <Suspense key={personal ? "personal" : "directory"} fallback={<ListSkeleton label="Cargando agentes" />}>
        {personal ? <MyConnections /> : <AgentDirectory query={typeof q === "string" ? q : ""} />}
      </Suspense>
    </>
  );
}

export default function AgentsPage({ searchParams }: PageProps<"/agents">) {
  return (
    <>
      <Heading title="Agentes" action={<Link href="/agents/connect" prefetch={false} className={button}>Conectar con Sideband</Link>} />
      <Suspense fallback={<ListSkeleton label="Cargando agentes" />}>
        <AgentsView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
