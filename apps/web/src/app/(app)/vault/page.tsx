import { contactTagNames, contactTags } from "@team-31/protocol/constants";
import { ownerClient } from "@/lib/broker";
import { readAsOwner } from "../owner";
import { button, card, Heading, input, secondaryText } from "../ui";
import { changeVault } from "./actions";

function Action({ action, id }: { action: string; id?: string }) {
  return <><input type="hidden" name="action" value={action} />{id && <input type="hidden" name="categoryId" value={id} />}</>;
}

const row = "flex flex-wrap items-center gap-2";
const field = `${input} max-w-xs`;
export default async function VaultPage() {
  const { data: { categories } } = await readAsOwner(o => ownerClient().vault(o));
  return <div className="max-w-3xl space-y-5">
    <Heading title="Mi bóveda">Guarda lo que necesitas, tus deseos u otros datos. Cada categoría empieza privada.</Heading>
    <form action={changeVault} className={row}>
      <Action action="create" /><input className={field} name="name" aria-label="Nombre de la categoría" placeholder="Nueva categoría" required maxLength={80} />
      <button className={button}>Crear categoría</button>
    </form>
    {categories.map(c => <section key={c.id} className={`${card} space-y-4 p-5`}>
      <h2 className="text-xl font-medium">{c.name}</h2>
      <p className={secondaryText}>{c.groups.length || c.contactGroups?.length
        ? `Pueden consultar todos sus datos: ${[...c.groups.map(g => contactTags[g].label), ...(c.contactGroups ?? []).map(g => g.name)].join(", ")}.`
        : "Solo tú puedes ver esta categoría."}</p>
      <div className={row}>{contactTagNames.map(group => <form key={group} action={changeVault}>
        <Action action="set_group" id={c.id} /><input type="hidden" name="group" value={group} />
        <input type="hidden" name="allowed" value={String(!c.groups.includes(group))} />
        <button className={button}>{c.groups.includes(group) ? "Quitar acceso" : "Dar acceso"}: {contactTags[group].label}</button>
      </form>)}</div>
      <dl>{c.entries.map(e => <div key={e.label} className={`${row} py-1`}>
        <dt className="font-medium">{e.label}:</dt><dd className="whitespace-pre-wrap break-words">{String(e.value)}</dd>
        <form action={changeVault}><Action action="delete_entry" id={c.id} /><input type="hidden" name="label" value={e.label} />
          <button className={button} aria-label={`Borrar dato: ${e.label}`}>Borrar dato</button></form>
      </div>)}</dl>
      <form action={changeVault} className={row}>
        <Action action="put_entry" id={c.id} />
        <input className={field} name="label" aria-label="Nombre del dato" placeholder="Nombre del dato" required maxLength={80} />
        <select className={field} name="kind" aria-label="Tipo de dato"><option value="text">Texto</option><option value="number">Número</option></select>
        <input className={field} name="value" aria-label="Valor del dato" placeholder="Valor" required maxLength={2000} />
        <button className={button}>Guardar dato</button>
        <p className={secondaryText}>Usa el mismo nombre para actualizar un dato existente.</p>
      </form>
      <details><summary>Administrar categoría</summary>
        <form action={changeVault} className={`${row} my-3`}><Action action="rename" id={c.id} />
          <input className={field} name="name" aria-label="Nuevo nombre" required defaultValue={c.name} maxLength={80} />
          <button className={button}>Renombrar</button></form>
        <form action={changeVault}><Action action="delete" id={c.id} /><button className={button}>Eliminar categoría, datos y permisos</button></form>
      </details>
    </section>)}
  </div>;
}
