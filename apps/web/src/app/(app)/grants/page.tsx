import { readGrants } from "../actions";
import { Heading } from "../ui";
import { GrantsEditor } from "./grants-editor";

export default async function GrantsPage() {
  const grants = await readGrants();
  return (
    <div className="max-w-4xl">
      <Heading title="Permisos">Decide quién puede preguntarle qué a tus agentes y qué datos recibe.</Heading>
      <GrantsEditor grants={grants} />
    </div>
  );
}
