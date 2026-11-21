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
  const { data: [{ categories }, { tags }] } = await readAsOwner(o => Promise.all([ownerClient().vault(o), ownerClient().tags(o)]));
  return <div className="max-w-3xl space-y-5">
    <Heading title="Mi bóveda">Guarda lo que necesitas, tus deseos u otros datos. Cada categoría empieza privada.</Heading>
    <form action={changeVault} className={row}>
      <Action action="create" /><input className={field} name="name" aria-label="Nombre de la categoría" placeholder="Nueva categoría" required maxLength={80} />
      <button className={button}>Crear categoría</button>
    </form>
    {categories.map(c => <section key={c.id} className={`${card} space-y-4 p-5`}>
      <h2 className="text-xl font-medium">{c.name}</h2>
      <div>
        <h3 className="font-medium">Personas con acceso de lectura</h3>
        {c.members?.length ? <ul className="list-disc pl-5">{c.members.map(address =>
          <li key={address} className="break-all">{address}</li>)}</ul>
          : <p className={secondaryText}>{c.members ? "Nadie tiene acceso." : "Lista no disponible."}</p>}
      </div>
      <p className={secondaryText}>Etiquetas con acceso: {tags.filter(t => c.tags.includes(t.id)).map(t => t.name).join(", ") || "Ninguna"}.</p>
      <div className={row}>{tags.map(tag => <form key={tag.id} action={changeVault}>
        <Action action="set_tag" id={c.id} /><input type="hidden" name="tagId" value={tag.id} />
        <input type="hidden" name="allowed" value={String(!c.tags.includes(tag.id))} />
        <button className={button}>{c.tags.includes(tag.id) ? "Quitar acceso" : "Dar acceso"}: {tag.name}</button>
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
