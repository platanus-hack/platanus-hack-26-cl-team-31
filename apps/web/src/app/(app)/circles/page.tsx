import type { Circle } from "@team-31/protocol";

import { deleteCircle, joinCircle, readCircles, removeFromCircle } from "./actions";
import { button, card, Empty, Heading, primaryButton, secondaryText } from "../ui";
import { CircleButton, CreateCircle, InviteMember } from "./circle-forms";

function CircleCard({ circle, address }: { circle: Circle; address: string }) {
  const isOwner = circle.owner === address;
  const invited = circle.members.some((member) => member.address === address && !member.joined);
  const leave = removeFromCircle.bind(null, circle.id, address);

  return (
    <li className={`${card} space-y-4 p-5 sm:p-6 has-[[data-gone=circle]]:hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{circle.name}</h3>
          <p className={secondaryText}>{isOwner ? "Lo creaste tú" : `Lo creó ${circle.owner}`}</p>
        </div>
        {isOwner && (
          <CircleButton action={deleteCircle.bind(null, circle.id)} className={button} hides="circle"
            label={`Eliminar el círculo ${circle.name}`}>Eliminar</CircleButton>
        )}
        {!isOwner && !invited && (
          <CircleButton action={leave} className={button} hides="circle" label={`Salir del círculo ${circle.name}`}>Salir</CircleButton>
        )}
      </div>

      {invited && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-bg px-4 py-3 has-[[data-gone=invitation]]:hidden">
          <p className="flex-1 text-sm text-warn">Te invitaron. Al aceptar, compartirás tu disponibilidad, tus horarios libres y las coincidencias de interés con los miembros.</p>
          <CircleButton action={joinCircle.bind(null, circle.id)} className={primaryButton} hides="invitation"
            label={`Aceptar la invitación a ${circle.name}`}>Aceptar</CircleButton>
          <CircleButton action={leave} className={button} hides="circle" label={`Rechazar la invitación a ${circle.name}`}>Rechazar</CircleButton>
        </div>
      )}

      <ul className="divide-y divide-line">
        {circle.members.map((member) => (
          <li key={member.address} className="flex flex-wrap items-center justify-between gap-3 py-2 has-[[data-gone=member]]:hidden">
            <span className="break-all text-sm font-medium">
              {member.address}
              {!member.joined && <span className="ml-2 font-normal text-muted">invitación pendiente</span>}
            </span>
            {isOwner && member.address !== address && (
              <CircleButton action={removeFromCircle.bind(null, circle.id, member.address)} className={button} hides="member"
                label={`Quitar a ${member.address} de ${circle.name}`}>Quitar</CircleButton>
            )}
          </li>
        ))}
      </ul>

      {isOwner && <InviteMember circleId={circle.id} circleName={circle.name} />}
    </li>
  );
}

export default async function CirclesPage() {
  const { address, circles } = await readCircles();
  return (
    <div className="max-w-2xl space-y-8">
      <Heading title="Círculos" action={<CreateCircle />}>
        Los miembros de un círculo comparten su disponibilidad, sus horarios libres y sus coincidencias de interés.
      </Heading>
      <section aria-labelledby="circles-title">
        <h2 id="circles-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Tus círculos</h2>
        {circles.length === 0 ? <Empty>Todavía no estás en ningún círculo. Toca Crear círculo para armar uno.</Empty> : (
          <ul className="space-y-4">
            {circles.map((circle) => <CircleCard key={circle.id} circle={circle} address={address} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
