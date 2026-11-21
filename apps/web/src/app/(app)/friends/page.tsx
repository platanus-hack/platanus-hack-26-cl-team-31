import { readFriends } from "../actions";
import { card, Empty, Heading } from "../ui";
import { ConnectForm, RemoveFriend } from "./friend-forms";

export default async function FriendsPage() {
  const friends = await readFriends();
  return (
    <div className="max-w-2xl space-y-8">
      <Heading title="Amigos">
        Envía una solicitud de conexión. El agente de la otra persona le preguntará si acepta.
      </Heading>
      <section className={`${card} p-5 sm:p-6`}>
        <ConnectForm />
      </section>
      <section aria-labelledby="friends-title">
        <h2 id="friends-title" className="mb-4 text-xl font-semibold tracking-tight">Conectados</h2>
        {friends.length === 0 ? <Empty>Todavía no tienes amigos conectados.</Empty> : (
          <ul className="space-y-2">
            {friends.map((address) => (
              <li key={address} className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-3`}>
                <span className="break-all font-medium">{address}</span>
                <RemoveFriend address={address} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
