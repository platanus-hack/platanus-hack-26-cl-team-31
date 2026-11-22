import { expect, it, vi } from "vitest";
import { configureBroker, isolatedDatabase, startBroker } from "./contact-stack.mjs";

it.skipIf(!process.env.TEST_DATABASE_URL)("reanuda una seed en conflicto sin conceder acceso a direcciones ajenas ni restaurar permisos", async () => {
  const cleanup = new AsyncDisposableStack();
  try {
    vi.stubEnv("TELEMETRY_SINK", "off");
    const db = await isolatedDatabase(cleanup);
    configureBroker();
    await startBroker(cleanup);
    vi.stubEnv("WEB_PORT", process.env.BROKER_PORT);
    const { contactOwner, contactPrincipal } = await import("../src/contact-broker.mjs");
    const { seedContactBroker } = await import("../src/seed-contact-broker.mjs");
    const owner = contactOwner();
    const ana = contactPrincipal("ana");
    const bob = contactPrincipal("bob");
    const outsider = { userId: "other-user" };
    await db.query("CREATE TABLE demo_profiles (person_id text PRIMARY KEY, interest_readers text[] NOT NULL)");
    await db.query(`INSERT INTO demo_profiles VALUES ('ana', '{}'), ('bob', '{ana,zoe}'), ('zoe', '{}')`);
    await owner.claimAddress(outsider, "demo-zoe");

    await expect(seedContactBroker()).rejects.toMatchObject({ code: "conflict" });
    expect(await owner.grants(bob)).toEqual([]);
    expect(await owner.grants(outsider)).toEqual([]);
    expect(await owner.agents(outsider)).toEqual([]);

    // Keep the conflicting address owned by the other account and remove only its fixture entry.
    await db.query("DELETE FROM demo_profiles WHERE person_id = 'zoe'");
    await expect(Promise.all([seedContactBroker(), seedContactBroker()])).resolves.toEqual([2, 2]);
    const grants = await owner.grants(bob);
    expect(grants).toEqual([expect.objectContaining({ grantee: "demo-ana@sideband.app", category: "interests" })]);
    expect(await owner.agents(bob)).toEqual([expect.objectContaining({ agentId: bob.agentId, wakeKind: "standard_webhook" })]);

    await owner.revokeGrant(bob, grants[0].id);
    await owner.setWake(bob, bob.agentId, { kind: "none" });
    await owner.revokeAgent(ana, ana.agentId);
    await seedContactBroker();
    expect(await owner.grants(bob)).toEqual([]);
    expect((await owner.agents(bob))[0].wakeKind).toBe("none");
    expect((await owner.agents(ana))[0].revokedAt).toEqual(expect.any(String));
  } finally {
    await cleanup.disposeAsync();
    vi.unstubAllEnvs();
  }
}, 30_000);
