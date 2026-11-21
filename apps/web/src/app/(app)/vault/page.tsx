import { ownerClient } from "@/lib/broker";

import { readAsOwner } from "../owner";
import { card, Heading } from "../ui";
import { CategoryRow, NewCategory } from "./vault-sheets";

export default async function VaultPage() {
  const { data: [{ categories }, { tags }] } = await readAsOwner((o) => Promise.all([ownerClient().vault(o), ownerClient().tags(o)]));
  return (
    <div>
      <Heading title="Mi bóveda" action={<NewCategory />} />
      {categories.length === 0 ? (
        <div className={`${card} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
          <p className="text-sm font-medium text-ink">Tu bóveda está vacía</p>
          <p className="max-w-sm text-[13px] text-muted">Guarda tus tallas, una lista de regalos o lo que quieras que tus agentes puedan contestar. Cada categoría empieza privada.</p>
        </div>
      ) : (
        <>
          <ul className={`${card} divide-y divide-line`}>
            {categories.map((category) => <CategoryRow key={`${category.id}:${category.name}:${category.description ?? ""}:${category.tags.join()}:${category.entries.length}`} category={category} tags={tags} />)}
          </ul>
          <p className="mt-3 px-1 text-xs text-muted">Cada categoría empieza privada. Las personas con las etiquetas que elijas pueden pedirle a tu agente que la lea.</p>
        </>
      )}
    </div>
  );
}
