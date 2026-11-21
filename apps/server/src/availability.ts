import type { PoolClient } from "pg";
import { z } from "zod";
import { defineTool } from "./tool.js";

// Pairs (requester, recipient, group) where the requester may ask and the recipient shares in that group.
const grants = `
  SELECT asker.person_id AS requester, owner.person_id AS recipient, asker.group_id
  FROM memberships asker
  JOIN memberships owner ON owner.group_id = asker.group_id
  WHERE asker.can_ask AND owner.can_share`;
const permission = `SELECT 1 FROM (${grants}) g WHERE requester=$1 AND recipient=$2 AND group_id=$3`;
const notShareable = { status: "not_shareable" } as const;
const groupName = z.string().trim().min(1).max(128);
export const personId = z.string().trim().min(1).toLowerCase();
const checkArgs = z.object({
  recipient: personId,
  group: groupName,
  slot: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(1).max(1440),
});

export async function allowed(db: PoolClient, requester: string, recipient: string, group: string) {
  const result = await db.query(`SELECT EXISTS (${permission}) AS allowed`, [requester, recipient, group]);
  return result.rows[0].allowed as boolean;
}

export async function groupAllowed(db: PoolClient, requester: string, recipients: string[], group: string) {
  const result = await db.query(`SELECT NOT EXISTS (
    SELECT unnest($2::text[]) EXCEPT SELECT recipient FROM (${grants}) g WHERE requester=$1 AND group_id=$3
  ) AS allowed`, [requester, recipients, group]);
  return result.rows[0].allowed as boolean;
}

// Only for an agent consulting its own calendar.
export async function isFree(db: PoolClient, person: string, slot: string, minutes: number) {
  const result = await db.query("SELECT calendar_is_free($1, $2, $3) AS free", [person, slot, minutes]);
  return result.rows[0].free as boolean;
}

export async function readAvailability(
  db: PoolClient, requester: string, recipient: string, group: string, slot: string, minutes: number,
): Promise<boolean | null> {
  // Evaluate permission and the bounded calendar projection in the same snapshot.
  const result = await db.query(`SELECT CASE WHEN EXISTS (${permission})
    THEN calendar_is_free($2, $4, $5) END AS free`, [requester, recipient, group, slot, minutes]);
  return result.rows[0].free;
}

async function saveCheck(db: PoolClient, me: string, args: z.infer<typeof checkArgs>) {
  const { recipient, group, slot, minutes } = args;
  const available = await readAvailability(db, me, recipient, group, slot, minutes);
  if (available === null) return;
  const result = await db.query(`INSERT INTO availability_requests(requester, recipient, group_id, available)
    VALUES ($1, $2, $3, $4) RETURNING id`, [me, recipient, group, available]);
  return result.rows[0].id as string;
}

async function deliverCheck(db: PoolClient, me: string, requestId: string) {
  const result = await db.query(`SELECT recipient, group_id, available FROM availability_requests
    WHERE requester = $1 AND id = $2`, [me, requestId]);
  const row = result.rows[0];
  if (!row || !await allowed(db, me, row.recipient, row.group_id)) return notShareable;
  return { status: row.available ? "available" : "busy", request_id: requestId };
}

const check = defineTool("availability_check", "Check if a group member is free during an interval.",
  checkArgs, async (db, me, args) => {
    const id = await saveCheck(db, me, args);
    return id ? deliverCheck(db, me, id) : notShareable;
  });

const get = defineTool("request_get", "Read an earlier availability answer with current permissions.",
  z.object({ request_id: z.uuid() }), (db, me, { request_id }) => deliverCheck(db, me, request_id));

const permissionTool = defineTool("group_permission", "Change your permission to ask or share availability in a group.",
  z.object({ group: groupName, can_ask: z.boolean().optional(), can_share: z.boolean().optional() }),
  async (db, me, { group, can_ask, can_share }) => {
    const result = await db.query(`UPDATE memberships
      SET can_ask = coalesce($3, can_ask), can_share = coalesce($4, can_share)
      WHERE person_id = $1 AND group_id = $2 RETURNING can_ask, can_share`,
    [me, group, can_ask, can_share]);
    return result.rows[0] ? { status: "updated", ...result.rows[0] } : notShareable;
  });

const leave = defineTool("group_leave", "Leave your group and withdraw its private interest listings.",
  z.object({ group: groupName }), async (db, me, { group }) => {
    await db.query("DELETE FROM memberships WHERE person_id = $1 AND group_id = $2", [me, group]);
    await db.query("DELETE FROM interests WHERE person_id = $1 AND audience = $2", [me, group]);
    return { status: "left" };
  });

export const interestName = z.string().trim().min(1).max(128);
const listingArgs = z.object({ interest: interestName, group: groupName.optional() });
export const topic = (interest: string) => interest.normalize("NFC").toLowerCase();

const publish = defineTool("interest_publish", "Publish an interest to a group, or publicly when group is omitted.",
  listingArgs, async (db, me, { interest, group }) => {
    if (group) {
      // Serialize publication with leaving the audience.
      const membership = await db.query("SELECT 1 FROM memberships WHERE person_id = $1 AND group_id = $2 FOR SHARE",
        [me, group]);
      if (!membership.rowCount) return notShareable;
    }
    await db.query(`INSERT INTO interests (person_id, interest, audience) VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING`, [me, topic(interest), group ?? ""]);
    return { status: "published" };
  });

// $1 is always the authenticated viewer. Direct reads, discovery and search use the same audience check.
export const visibleInterests = `SELECT i.* FROM interests i WHERE i.audience = '' OR EXISTS (
  SELECT 1 FROM memberships viewer JOIN memberships publisher USING (group_id)
  WHERE viewer.group_id = i.audience AND viewer.person_id = $1 AND publisher.person_id = i.person_id
)`;

const search = defineTool("interest_search", "Find an interest in one audience. Omit group to search public listings.",
  listingArgs, async (db, me, { interest, group }) => {
    const result = await db.query(`SELECT person_id AS person, interest FROM (${visibleInterests}) i
      WHERE interest = $2 AND audience = $3 ORDER BY person_id`, [me, topic(interest), group ?? ""]);
    return { entries: result.rows };
  });

const recipientArgs = z.object({ recipient: personId });

const interestsForPerson = defineTool("agent_interests", "Read the interests this person has published for you.",
  recipientArgs, async (db, me, { recipient }) => {
    const result = await db.query(`SELECT DISTINCT interest FROM (${visibleInterests}) i
      WHERE person_id = $2 ORDER BY interest`, [me, recipient]);
    return { interests: result.rows.map(row => row.interest) };
  });

export const capabilities = defineTool("agent_capabilities", "Discover the questions you can ask a particular agent now.",
  recipientArgs, async (db, me, { recipient }) => {
    const result = await db.query<{ groups: string[], interests: boolean }>(`SELECT
      ARRAY(SELECT group_id FROM (${grants}) g WHERE requester=$1 AND recipient=$2 ORDER BY group_id) AS groups,
      EXISTS (SELECT 1 FROM (${visibleInterests}) i WHERE person_id=$2) AS interests`, [me, recipient]);
    const { groups, interests } = result.rows[0]!;
    const tools = [];
    const target = { type: "string", const: recipient };
    if (groups.length) {
      tools.push({
        name: check.name, description: check.description, execution: "stored",
        inputSchema: { ...check.inputSchema, properties: {
          ...check.inputSchema.properties, recipient: target, group: { type: "string", enum: groups },
        } },
      });
    }
    if (interests) {
      tools.push({
        name: interestsForPerson.name, description: interestsForPerson.description, execution: "stored",
        inputSchema: { ...interestsForPerson.inputSchema, properties: { recipient: target } },
      });
    }
    return { tools };
  });

const withdraw = defineTool("interest_withdraw", "Remove your interest listing from its original audience.",
  listingArgs, async (db, me, { interest, group }) => {
    await db.query("DELETE FROM interests WHERE person_id = $1 AND interest = $2 AND audience = $3",
      [me, topic(interest), group ?? ""]);
    return { status: "withdrawn" };
  });

export const availabilityTools = [check, get, permissionTool, leave, publish, search, withdraw, interestsForPerson, capabilities];
