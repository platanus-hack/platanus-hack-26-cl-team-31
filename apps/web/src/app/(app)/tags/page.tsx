import { ownerClient } from "@/lib/broker";

import { readAsOwner } from "../owner";
import { card, Empty, Heading } from "../ui";
import { NewTag, TagRow } from "./tag-sheets";

export default async function TagsPage() {
  const { data: { tags } } = await readAsOwner((owner) => ownerClient().tags(owner));
  return (
    <div>
      <Heading title="Etiquetas" action={<NewTag />} />
      {tags.length === 0 ? <Empty>Todavía no tienes etiquetas.</Empty> : (
        <ul className={`${card} divide-y divide-line`}>
          {tags.map((tag) => <TagRow key={tag.id} tag={tag} />)}
        </ul>
      )}
      <p className="mt-3 px-1 text-xs text-muted">Un contacto recibe lo de todas sus etiquetas. Los contactos que personalizaste conservan lo suyo.</p>
    </div>
  );
}
