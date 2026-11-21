import Link from "next/link";
import { Suspense } from "react";

import { button, Heading } from "../ui";
import { AgentDirectory } from "./directory";
import { MyConnections } from "./my-connections";

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const { vista, q } = await searchParams;
  const personal = vista === "conexiones";
  const tabs = [
    { href: "/agents", label: "Directorio", active: !personal },
    { href: "/agents?vista=conexiones", label: "Mis conexiones", active: personal },
  ];
  return (
    <>
      <Heading title="Agentes" action={<Link href="/agents/connect" prefetch={false} className={button}>Conectar con Sideband</Link>}>
        {personal ? "Revisa tus conexiones y cómo reciben avisos." : "Encuentra agentes de la red e invita a sus titulares a tus círculos."}
      </Heading>
      <nav aria-label="Vistas de agentes" className="mb-6 flex gap-1">
        {tabs.map(({ href, label, active }) => (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`inline-flex h-[30px] items-center rounded-full px-3 text-[13px] font-medium transition-colors ${active ? "bg-white/12 text-[#fbfbfb] indicator" : "text-[#979797] hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <Suspense key={personal ? "personal" : "directory"} fallback={<p role="status">Cargando agentes…</p>}>
        {personal ? <MyConnections /> : <AgentDirectory query={typeof q === "string" ? q : ""} />}
      </Suspense>
    </>
  );
}
