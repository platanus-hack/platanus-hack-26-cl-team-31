import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function createWhatsAppStore(db: Pool) {
  async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await db.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async function claim(connection: Pick<PoolClient, "query">, numberId: string, messageId: string) {
    await connection.query("DELETE FROM whatsapp.receipt WHERE expires_at <= now()");
    const { rowCount } = await connection.query(`
      INSERT INTO whatsapp.receipt (id, expires_at) VALUES ($1, now() + interval '2 days')
      ON CONFLICT DO NOTHING`, [digest(`${numberId}:${messageId}`)]);
    return rowCount === 1;
  }

  return {
    async state(userId: string) {
      const { rows } = await db.query<{ linked: string | null; id: string | null; phone: string | null }>(`
        SELECT CASE WHEN u.whatsapp_linked_at IS NOT NULL THEN u."phoneNumber" END AS linked, p.id, p.phone
        FROM public."user" u LEFT JOIN whatsapp.pairing p ON p.user_id = u.id AND p.expires_at > now()
        WHERE u.id = $1`, [userId]);
      return rows[0];
    },
    async start(userId: string) {
      const code = randomBytes(16).toString("hex");
      return transaction(async (tx) => {
        const { rows } = await tx.query(`SELECT 1 FROM public."user" WHERE id = $1 AND "phoneNumber" IS NULL FOR UPDATE`, [userId]);
        if (!rows.length) return;
        await tx.query(`DELETE FROM whatsapp.pairing WHERE expires_at <= now()`);
        await tx.query(`
          INSERT INTO whatsapp.pairing (user_id, id, code_hash, expires_at)
          VALUES ($1, $2, $3, now() + interval '10 minutes')
          ON CONFLICT (user_id) DO UPDATE SET id = EXCLUDED.id, code_hash = EXCLUDED.code_hash,
            expires_at = EXCLUDED.expires_at, phone = NULL`, [userId, randomUUID(), digest(code)]);
        return code;
      });
    },
    async detect(code: string, phone: string) {
      const { rows } = await db.query<{ user_id: string }>(`
        UPDATE whatsapp.pairing SET phone = $2
        WHERE code_hash = $1 AND phone IS NULL AND expires_at > now()
        RETURNING user_id`, [digest(code), phone]);
      return rows[0]?.user_id;
    },
    async confirm(userId: string, id: string) {
      return transaction(async (tx) => {
        const owner = await tx.query(`SELECT 1 FROM public."user" WHERE id = $1 AND "phoneNumber" IS NULL FOR UPDATE`, [userId]);
        if (!owner.rowCount) return;
        const { rows } = await tx.query<{ phone: string }>(`
          DELETE FROM whatsapp.pairing WHERE user_id = $1 AND id = $2 AND phone IS NOT NULL AND expires_at > now()
          RETURNING phone`, [userId, id]);
        if (!rows[0]) return;
        const linked = await tx.query<{ link_id: string }>(`UPDATE public."user" SET "phoneNumber" = $2,
            whatsapp_linked_at = clock_timestamp(), whatsapp_link_id = gen_random_uuid()
          WHERE id = $1 RETURNING whatsapp_link_id AS link_id`, [userId, rows[0].phone]);
        return linked.rows[0]!.link_id;
      });
    },
    async unlink(userId: string) {
      await transaction(async (tx) => {
        await tx.query(`SELECT 1 FROM public."user" WHERE id = $1 FOR UPDATE`, [userId]);
        await tx.query(`UPDATE public."user" SET "phoneNumber" = NULL, whatsapp_linked_at = NULL,
            whatsapp_link_id = NULL, whatsapp_last_inbound_at = NULL
          WHERE id = $1 AND whatsapp_linked_at IS NOT NULL`, [userId]);
        await tx.query(`DELETE FROM whatsapp.pairing WHERE user_id = $1`, [userId]);
        await tx.query(`DELETE FROM whatsapp.pending_delivery WHERE user_id = $1`, [userId]);
      });
    },
    claim: (numberId: string, messageId: string) => claim(db, numberId, messageId),
    // Order disconnect and sensitive delivery: disconnect waits for work already holding this lock.
    async whileLinked(phone: string, timestamp: number, run: (userId: string | undefined) => Promise<void>) {
      // Before the shared lock below: updating the row while holding it would deadlock with another
      // message from the same phone holding the same lock.
      await db.query(`UPDATE public."user" SET whatsapp_last_inbound_at = to_timestamp($2)
        WHERE "phoneNumber" = $1 AND whatsapp_linked_at <= to_timestamp($2)
          AND (whatsapp_last_inbound_at IS NULL OR whatsapp_last_inbound_at < to_timestamp($2))`, [phone, timestamp]);
      await transaction(async (tx) => {
        const { rows } = await tx.query<{ id: string }>(`
          SELECT id FROM public."user" WHERE "phoneNumber" = $1
            AND whatsapp_linked_at <= to_timestamp($2) FOR SHARE`, [phone, timestamp]);
        await run(rows[0]?.id);
      });
    },
    // Links confirmed before broker notices existed have no notice id. The owner's next message
    // issues one, and only one concurrent message gets it back.
    async assignLinkId(phone: string) {
      const { rows } = await db.query<{ userId: string; linkId: string }>(`
        UPDATE public."user" SET whatsapp_link_id = gen_random_uuid()
        WHERE "phoneNumber" = $1 AND whatsapp_linked_at IS NOT NULL AND whatsapp_link_id IS NULL
        RETURNING id AS "userId", whatsapp_link_id AS "linkId"`, [phone]);
      return rows[0];
    },
    // Same ordering as whileLinked, for a broker notice addressed to the link in its URL.
    async whileNotified(linkId: string, run: (link: {
      userId: string; phone: string; windowOpen: boolean;
      acceptNotice(requestId: string, phase: "final" | "owner", send: () => Promise<void>): Promise<boolean>;
    } | undefined) => Promise<void>) {
      await transaction(async (tx) => {
        const { rows } = await tx.query<{ userId: string; phone: string; windowOpen: boolean }>(`
          SELECT id AS "userId", "phoneNumber" AS phone,
            coalesce(whatsapp_last_inbound_at > now() - interval '23 hours 55 minutes', false) AS "windowOpen"
          FROM public."user" WHERE whatsapp_link_id = $1 AND whatsapp_linked_at IS NOT NULL FOR SHARE`, [linkId]);
        const link = rows[0];
        if (!link) return run(undefined);
        await run({
          ...link,
          async acceptNotice(requestId, phase, send) {
            if (!await claim(tx, "notice", `${requestId}:${phase}`)) return false;
            if (link.windowOpen) await send();
            else await tx.query(`INSERT INTO whatsapp.pending_delivery (user_id, request_id) VALUES ($1, $2)
              ON CONFLICT DO NOTHING`, [link.userId, requestId]);
            return true;
          },
        });
      });
    },
    async pending(userId: string) {
      const { rows } = await db.query<{ request_id: string }>(`
        SELECT request_id FROM whatsapp.pending_delivery WHERE user_id = $1 ORDER BY created_at`, [userId]);
      return rows.map((row) => row.request_id);
    },
    async clearPending(userId: string, requestId: string) {
      await db.query(`DELETE FROM whatsapp.pending_delivery WHERE user_id = $1 AND request_id = $2`, [userId, requestId]);
    },
  };
}
