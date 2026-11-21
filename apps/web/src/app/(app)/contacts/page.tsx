import { cache, Suspense } from "react";

import { readContacts } from "./actions";
import { Segmented } from "../sliding";
import { card, Empty, Heading, PageSkeleton, Stamp } from "../ui";
import { ContactRow, IncomingInvitation, InviteButton } from "./contact-forms";
import { describeSharing } from "./describe";

const contactsData = cache(readContacts);

type View = "contactos" | "solicitudes" | "enviadas";

async function ContactsList({ searchParams }: { searchParams: PageProps<"/contacts">["searchParams"] }) {
  const { vista } = await searchParams;
  const view: View = vista === "solicitudes" || vista === "enviadas" ? vista : "contactos";
  const { contacts, tags, incoming, outgoing } = await contactsData();
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: "contactos", label: "Contactos" },
    { id: "solicitudes", label: "Solicitudes", count: incoming.length },
    { id: "enviadas", label: "Enviadas", count: outgoing.length },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented label="Vistas de contactos" items={tabs.map(({ id, label, count }) => ({
        key: id, href: id === "contactos" ? "/contacts" : `/contacts?vista=${id}`, active: view === id,
        label: <>{label}{count ? <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${id === "solicitudes" ? "bg-accent-soft text-accent-ink" : "bg-white/8 text-body"}`}>{count}</span> : null}</>,
      }))} />
      <InviteButton tags={tags} />
      </div>

      {view === "solicitudes" && (incoming.length === 0 ? <Empty>No tienes solicitudes pendientes.</Empty> : (
        <ul className={`${card} divide-y divide-line`}>
          {incoming.map((invitation) => <IncomingInvitation key={invitation.requestId} invitation={invitation} tags={tags} />)}
        </ul>
      ))}

      {view === "enviadas" && (outgoing.length === 0 ? <Empty>No tienes invitaciones esperando respuesta.</Empty> : (
        <ul className={`${card} divide-y divide-line`}>
          {outgoing.map((invitation) => (
            <li key={invitation.requestId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{invitation.address}</p>
                <p className="text-xs text-muted">Le compartirás: {describeSharing(invitation.offer)}</p>
              </div>
              <p className="text-xs text-muted">Vence el <Stamp value={invitation.expiresAt} /></p>
            </li>
          ))}
        </ul>
      ))}

      {view === "contactos" && (
        <>
          {contacts.length === 0 ? <Empty>Todavía no tienes contactos. Toca Invitar para conectar con alguien.</Empty> : (
            <ul className="space-y-2">
              {contacts.map((contact) => <ContactRow key={contact.address} contact={contact} tags={tags} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  return (
    <div>
      <Heading title="Contactos" />
      <Suspense fallback={<PageSkeleton tabs label="Cargando contactos" />}>
        <ContactsList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
