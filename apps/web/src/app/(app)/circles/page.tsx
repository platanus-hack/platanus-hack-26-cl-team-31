import { readCircles } from "./actions";
import { CircleInvitations, CircleTile } from "./circle-cards";
import { CreateCircle } from "./circle-forms";
import { card, Heading } from "../ui";

export default async function CirclesPage() {
  const { address, circles } = await readCircles();
  const invited = circles.filter((circle) => circle.members.some((member) => member.address === address && !member.joined));
  const mine = circles.filter((circle) => !invited.includes(circle));
  return (
    <div className="space-y-8">
      <Heading title="Círculos" action={<CreateCircle />} />
      {invited.length > 0 && (
        <section aria-labelledby="invited-title" className="space-y-3">
          <h2 id="invited-title" className="text-[15px] font-medium tracking-[-0.01em]">Invitaciones</h2>
          {invited.length === 1 && <p className="-mt-1 text-xs text-muted">Si aceptas, compartirás tu disponibilidad, tus horarios libres y tus coincidencias de interés con sus miembros.</p>}
          <CircleInvitations circles={invited} address={address} />
        </section>
      )}
      <section aria-labelledby="circles-title" className="space-y-3">
        <h2 id="circles-title" className="text-[15px] font-medium tracking-[-0.01em]">Tus círculos</h2>
        {mine.length === 0 ? (
          <div className={`${card} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
            <p className="text-sm font-medium text-ink">Todavía no estás en ningún círculo</p>
            <p className="max-w-sm text-[13px] text-muted">Un círculo es un grupo, como «Fútbol del sábado». Sus miembros comparten disponibilidad e intereses para coordinar más fácil.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((circle) => <CircleTile key={`${circle.id}:${circle.members.length}`} circle={circle} address={address} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
