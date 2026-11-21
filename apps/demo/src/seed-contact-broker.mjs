import { pathToFileURL } from "node:url";
import pg from "pg";
import { contactAddress, contactAgent, contactOwner, contactPrincipal, contactWakeSecret, contactWakeUrl, getDemoTelemetry } from "./contact-broker.mjs";

function seeded(principal, action) {
  getDemoTelemetry().emit("demo.contact.seeded", { userId: principal.userId, agentId: principal.agentId, attrs: { action } });
}

export function seedContactBroker() {
  return getDemoTelemetry().context({}, importProfiles);
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
      const claimed = await owner.claimAddress(principal, address.split("@")[0]);
      if (claimed !== address) throw new Error("El dominio del broker no coincide con el de la demo.");
      seeded(principal, "address");
    }

    for (const { person_id: id, interest_readers: readers } of rows) {
      const principal = contactPrincipal(id);
      // The connection is created last, so it marks a seeded identity. From then on its grants and
      // its connection, even disabled or revoked, belong to the owner.
      const connections = await owner.agents(principal);
      if (connections.some(connection => connection.agentId === principal.agentId)) continue;
      for (const reader of readers.filter(reader => roster.has(reader))) {
        await owner.setGrant(principal, { grantee: contactAddress(reader), category: "interests" });
      }
      seeded(principal, "grants");
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
    const errorId = getDemoTelemetry().error("demo.contact.seed", error);
    process.stderr.write(`No se pudo preparar Contactos de Ana. Comprueba la seed local y el broker. Referencia ${errorId}.\n`);
    process.exitCode = 1;
  } finally {
    await getDemoTelemetry().shutdown();
  }
}
