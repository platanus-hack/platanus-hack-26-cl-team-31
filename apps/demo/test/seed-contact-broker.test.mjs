import { expect, it, vi } from "vitest";
import { configureBroker, isolatedDatabase, startBroker } from "./contact-stack.mjs";

it.skipIf(!process.env.TEST_DATABASE_URL)("reanuda una seed en conflicto sin conceder acceso a direcciones ajenas ni restaurar permisos", async () => {
  const cleanup = new AsyncDisposableStack();
  try {
    vi.stubEnv("TELEMETRY_SINK", "off");
    const db = await isolatedDatabase(cleanup);
    await configureBroker();
    vi.stubEnv("WEB_PORT", process.env.BROKER_PORT);
    await startBroker(cleanup);
    const { contactOwner, contactPrincipal } = await import("../src/contact-broker.mjs");
    const { seedContactBroker } = await import("../src/seed-contact-broker.mjs");
    const owner = contactOwner();
    const ana = contactPrincipal("ana");
    const bob = contactPrincipal("bob");
    const outsider = { userId: "other-user" };
    await db.query("CREATE TABLE demo_profiles (person_id text PRIMARY KEY, interest_readers text[] NOT NULL)");
    await db.query(`INSERT INTO demo_profiles VALUES ('ana', '{}'), ('bob', '{ana,zoe}'), ('zoe', '{}')`);
    await owner.claimAddress(outsider, "demo-zoe");
    const outsiderRules = await owner.getRules(outsider);

    await expect(seedContactBroker()).rejects.toMatchObject({ code: "conflict" });
    const pending = await owner.getRules(bob);
    expect(pending.defaultForUnknown).toBe("deny");
    expect(pending.people).toEqual({});
    expect(await owner.getRules(outsider)).toEqual(outsiderRules);
    expect(await owner.agents(outsider)).toEqual([]);

    // Keep the conflicting address owned by the other account and remove only its fixture entry.
    await db.query("DELETE FROM demo_profiles WHERE person_id = 'zoe'");
    await expect(Promise.all([seedContactBroker(), seedContactBroker()])).resolves.toEqual([2, 2]);
    const rules = await owner.getRules(bob);
    expect(rules.people).toEqual({ "demo-ana@nexo.app": [{ tool: "interest_check", fields: ["matches"], guidance: "" }] });
    expect(rules.circles).toEqual({});
    expect(await owner.agents(bob)).toEqual([expect.objectContaining({ agentId: bob.agentId, wakeKind: "standard_webhook" })]);

    await owner.setRules(bob, { ...rules, people: {} });
    await owner.setWake(bob, bob.agentId, { kind: "none" });
    await owner.revokeAgent(ana, ana.agentId);
    await seedContactBroker();
    expect((await owner.getRules(bob)).people).toEqual({});
    expect((await owner.agents(bob))[0].wakeKind).toBe("none");
    expect((await owner.agents(ana))[0].revokedAt).toEqual(expect.any(String));
  } finally {
    await cleanup.disposeAsync();
    vi.unstubAllEnvs();
  }
}, 30_000);
