import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { SharingRules } from "@team-31/protocol";
import pg from "pg";
import { contactAddress, contactAgent, contactOwner, contactPrincipal, contactWakeSecret, contactWakeUrl, demoTelemetry } from "./contact-broker.mjs";

const defaultRules = SharingRules.parse({ circles: {}, grants: {} });
// An empty circle grants nothing. It marks a new identity until every reader's address is verified.
const pendingRules = SharingRules.parse({ circles: { "demo-contact-seed-pending": [] }, grants: {}, defaultForUnknown: "deny" });

function seeded(principal, action) {
  demoTelemetry.emit("demo.contact.seeded", { userId: principal.userId, agentId: principal.agentId, attrs: { action } });
}

export function seedContactBroker() {
  return demoTelemetry.context({}, importProfiles);
}

async function importProfiles() {
  if (!process.env.DATABASE_URL) throw new Error("Ejecuta la seed con pnpm with-env.");
  const owner = contactOwner();
  const agent = contactAgent();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // Serialize with both the coordination seed and other imports. Closing this session releases the lock.
    await db.query("SELECT pg_advisory_lock(hashtext('coordination.demo.seed'))");
    const { rows } = await db.query("SELECT person_id, interest_readers FROM demo_profiles ORDER BY person_id");
    const roster = new Set(rows.map(row => row.person_id));
    if (!roster.has("ana")) throw new Error("Falta el perfil de Ana. Ejecuta pnpm agents:seed.");

    // Only publish grants once every address belongs to its expected namespaced principal.
    for (const { person_id: id } of rows) {
      const principal = contactPrincipal(id);
      const address = contactAddress(id);
      const me = await owner.me(principal);
      if (me.address === address) continue;
      if (me.address) throw new Error("La identidad de demo ya tiene otra dirección.");
      if (isDeepStrictEqual(await owner.getRules(principal), defaultRules)) {
        await owner.setRules(principal, pendingRules);
        seeded(principal, "rules");
      }
      const claimed = await owner.claimAddress(principal, address.split("@")[0]);
      if (claimed !== address) throw new Error("El dominio del broker no coincide con el de la demo.");
      seeded(principal, "address");
    }

    for (const { person_id: id, interest_readers: readers } of rows) {
      const principal = contactPrincipal(id);
      if (isDeepStrictEqual(await owner.getRules(principal), pendingRules)) {
        const people = Object.fromEntries(readers.filter(reader => roster.has(reader)).map(reader => [
          contactAddress(reader), [{ tool: "interest_check", fields: ["matches"] }],
        ]));
        await owner.setRules(principal, SharingRules.parse({ circles: {}, grants: {}, people, defaultForUnknown: "deny" }));
        seeded(principal, "rules");
      }
      // Existing connections, including disabled or revoked ones, belong to the owner.
      const connections = await owner.agents(principal);
      if (connections.some(connection => connection.agentId === principal.agentId)) continue;
      await agent.connectWake(principal, { kind: "standard_webhook", url: contactWakeUrl(id), secret: contactWakeSecret(id) });
      seeded(principal, "wake");
    }
    return rows.length;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await seedContactBroker();
    process.stdout.write(`Broker local preparado para ${count} perfiles de Contactos de Ana.\n`);
  } catch (error) {
    const errorId = demoTelemetry.error("demo.contact.seed", error);
    process.stderr.write(`No se pudo preparar Contactos de Ana. Comprueba la seed local y el broker. Referencia ${errorId}.\n`);
    process.exitCode = 1;
  } finally {
    await demoTelemetry.shutdown();
  }
}
