import { Suspense } from "react";

import { readContacts } from "../actions";
import { card, Empty, Heading, Stamp } from "../ui";
import { ContactRow, IncomingInvitation, InviteForm } from "./contact-forms";
import { describeSharing } from "./describe";

async function ContactsList() {
  const { contacts, incoming, outgoing } = await readContacts();
  return (
    <div className="space-y-10">
      {incoming.length > 0 && (
        <section aria-labelledby="incoming-title">
          <h2 id="incoming-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Invitaciones</h2>
          <ul className="space-y-3">
            {incoming.map((invitation) => <IncomingInvitation key={invitation.requestId} invitation={invitation} />)}
          </ul>
        </section>
      )}

      <InviteForm />

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
        {contacts.length === 0 ? <Empty>Todavía no tienes contactos. Invita a alguien con su dirección Nexo.</Empty> : (
          <ul className="space-y-2">
            {contacts.map((contact) => <ContactRow key={contact.address} contact={contact} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ContactsPage() {
  return (
    <div className="max-w-2xl">
      <Heading title="Contactos">
        Al conectarte con alguien, cada uno elige qué le comparte al otro. Puedes cambiarlo cuando quieras.
      </Heading>
      <Suspense fallback={<p role="status">Cargando contactos…</p>}>
        <ContactsList />
      </Suspense>
    </div>
  );
}
