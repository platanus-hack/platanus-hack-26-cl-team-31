import { readRules } from "../actions";
import { Heading } from "../ui";
import { RulesEditor } from "./rules-editor";

export default async function RulesPage() {
  const rules = await readRules();
  return (
    <div className="max-w-4xl">
      <Heading title="Reglas para compartir">Decide qué datos pueden compartir tus agentes y con quién.</Heading>
      <RulesEditor initial={rules} />
    </div>
  );
}
