// Seeds the WhatsApp cast as contacts of one owner. Run it again to restore each member's data and sharing.
// Usage: pnpm agents:cast:seed <owner address>
import { pathToFileURL } from "node:url";
import pg from "pg";
import { Address } from "@team-31/protocol";
import { contactAgent, contactOwner, demoWakeSecret, demoWakeUrl, getDemoTelemetry } from "./contact-broker.mjs";
import { cast, castAddress, castPrincipal, healthCategory } from "./cast.mjs";

function seeded(principal, action) {
  getDemoTelemetry().emit("demo.contact.seeded", { userId: principal.userId, agentId: principal.agentId, attrs: { action } });
}

async function ownerId(address) {
  if (!process.env.DATABASE_URL) throw new Error("Ejecuta la seed con pnpm with-env.");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query("SELECT user_id FROM sideband.users WHERE address = $1", [address]);
    if (!rows[0]) throw new Error(`${address} no tiene cuenta en el broker local. Entra a web y reclama tu dirección.`);
    return rows[0].user_id;
  } finally {
    await db.end();
  }
}

async function connect(owners, principal, target, address, shares) {
  const view = await owners.contacts(principal);
  if (!view.contacts.some(contact => contact.address === address)) {
    const open = view.outgoing.find(invitation => invitation.address === address);
    const requestId = open?.requestId ?? (await owners.connect(principal, { to: address, share: shares })).requestId;
    await owners.answerInvitation(target, requestId, { accept: true, share: [] });
  }
  await owners.setSharing(principal, address, shares);
}

// Health lives in the vault category «Salud». The seeded owner reads it only when the member shares health.
async function seedHealth(owners, principal, member, address) {
  const existing = (await owners.vault(principal)).categories.find(category => category.name === healthCategory);
  const categoryId = existing?.id ?? (await owners.changeVault(principal, { action: "create", name: healthCategory })).categoryId;
  for (const entry of existing?.entries ?? []) {
    if (!member.health.some(({ label }) => label === entry.label)) {
      await owners.changeVault(principal, { action: "delete_entry", categoryId, label: entry.label });
    }
  }
  for (const entry of member.health) await owners.changeVault(principal, { action: "put_entry", categoryId, ...entry });
  await owners.changeVault(principal, { action: "set_member", categoryId, address, allowed: member.shares.includes("health") });
}

export function seedCast(address) {
  return getDemoTelemetry().context({}, async () => {
    const target = { userId: await ownerId(Address.parse(address)) };
    const owners = contactOwner();
    const agent = contactAgent();
    for (const member of cast) {
      const principal = castPrincipal(member.id);
      const me = await owners.me(principal);
      if (!me.address) {
        await owners.claimAddress(principal, member.id);
        seeded(principal, "address");
      } else if (me.address !== castAddress(member.id)) {
        throw new Error(`${principal.userId} ya tiene otra dirección.`);
      }
      await agent.connectWake(principal, {
        kind: "standard_webhook", url: demoWakeUrl("cast-wake", member.id), secret: demoWakeSecret("cast-wake", member.id),
      });
      seeded(principal, "wake");
      await connect(owners, principal, target, address, member.shares);
      await seedHealth(owners, principal, member, address);
      seeded(principal, "grants");
    }
    return cast.length;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await seedCast(process.argv[2]);
    process.stdout.write(`Elenco listo: ${count} contactos de ${process.argv[2]}. Míralos en /demo/elenco.\n`);
  } catch (error) {
    const errorId = getDemoTelemetry().error("demo.cast.seed", error);
    process.stderr.write(`No se pudo preparar el elenco: ${error.message} Referencia ${errorId}.\n`);
    process.exitCode = 1;
  } finally {
    await getDemoTelemetry().shutdown();
  }
}
