import { Suspense } from "react";
import { ownerClient } from "@/lib/broker";
import { readAsOwner } from "../owner";

import { readContacts } from "./actions";
import { card, Empty, Heading, Stamp } from "../ui";
import { ContactRow, IncomingInvitation, InviteForm, TagPresetsEditor } from "./contact-forms";
import { describeSharing } from "./describe";

async function PrivateGroups() {
  const { data: { groups, categories } } = await readAsOwner(o => ownerClient().contactGroups(o));
  return <section aria-labelledby="groups-title" className="mb-10 space-y-3">
    <h2 id="groups-title" className="font-medium">Grupos privados</h2>
    {groups.length === 0 ? <Empty>Todavía no tienes grupos privados.</Empty> : <ul className="space-y-2">
      {groups.map(group => {
        const shared = categories.filter(c => c.contactGroups.some(g => g.id === group.id));
        return <li key={group.id} className={`${card} space-y-1 px-5 py-3`}>
          <h3 className="font-medium">{group.name}</h3>
          <p className="break-words text-sm">Miembros: {group.members.join(", ") || "Sin miembros"}</p>
          <p className="text-sm">Categorías compartidas: {shared.map(c => c.name).join(", ") || "Ninguna"}</p>
        </li>;
      })}
    </ul>}
  </section>;
}

async function ContactsList() {
  const { contacts, presets, incoming, outgoing } = await readContacts();
  return (
    <div className="space-y-10">
      {incoming.length > 0 && (
        <section aria-labelledby="incoming-title">
          <h2 id="incoming-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Invitaciones</h2>
          <ul className="space-y-3">
            {incoming.map((invitation) => <IncomingInvitation key={invitation.requestId} invitation={invitation} presets={presets} />)}
          </ul>
        </section>
      )}

      <InviteForm presets={presets} />

      {outgoing.length > 0 && (
        <section aria-labelledby="outgoing-title">
          <h2 id="outgoing-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Esperando respuesta</h2>
          <ul className={`${card} divide-y divide-line`}>
            {outgoing.map((invitation) => (
              <li key={invitation.requestId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="break-all font-medium">{invitation.address}</p>
                  <p className="text-xs text-muted">Le compartirás: {describeSharing(invitation.offer)}</p>
                </div>
                <p className="text-xs text-muted">Vence el <Stamp value={invitation.expiresAt} /></p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="contacts-title">
        <h2 id="contacts-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Tus contactos</h2>
        {contacts.length === 0 ? <Empty>Todavía no tienes contactos. Invita a alguien con su dirección Sideband.</Empty> : (
          <ul className="space-y-2">
            {contacts.map((contact) => <ContactRow key={contact.address} contact={contact} presets={presets} />)}
          </ul>
        )}
      </section>

      <TagPresetsEditor presets={presets} />
    </div>
  );
}

export default function ContactsPage() {
  return (
    <div className="max-w-2xl">
      <Heading title="Contactos">
        Cada contacto tiene una etiqueta que define qué le compartes. Si quieres, ajustas a alguien en particular.
      </Heading>
      <Suspense fallback={<p role="status">Cargando grupos…</p>}>
        <PrivateGroups />
      </Suspense>
      <Suspense fallback={<p role="status">Cargando contactos…</p>}>
        <ContactsList />
      </Suspense>
    </div>
  );
}
