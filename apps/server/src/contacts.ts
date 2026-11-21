import { z } from "zod";
import { capabilities, interestName, personId, topic, visibleInterests } from "./availability.js";
import { defineTool } from "./tool.js";

const address = z.object({ recipient: personId.max(128) });

const connect = defineTool("contact_connect", "Save an address in your personal contacts and discover what you may ask.",
  address, async (db, me, args) => {
    if (args.recipient === me) return { error: "self_contact" };
    await db.query("INSERT INTO contacts (owner_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [me, args.recipient]);
    return capabilities.run(db, me, args);
  });

const remove = defineTool("contact_remove", "Remove an address from your personal contacts.",
  address, async (db, me, { recipient }) => {
    await db.query("DELETE FROM contacts WHERE owner_id=$1 AND contact_id=$2", [me, recipient]);
    return { status: "removed" };
  });

const search = defineTool("contact_interest_search", "Search your saved contacts for an interest visible to you.",
  z.object({ interest: interestName }), async (db, me, { interest }) => {
    const result = await db.query(`SELECT DISTINCT i.person_id AS person, i.interest
      FROM contacts c JOIN (${visibleInterests}) i ON i.person_id = c.contact_id
      WHERE c.owner_id = $1 AND i.interest = $2 ORDER BY person`, [me, topic(interest)]);
    return { entries: result.rows };
  });

export const contactTools = [connect, remove, search];
