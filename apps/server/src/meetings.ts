import type { PoolClient } from "pg";
import { z } from "zod";
import { groupAllowed, isFree, personId, readAvailability } from "./availability.js";
import { defineTool } from "./tool.js";

type Status = "collecting" | "no_shared_slot" | "proposed" | "declined" | "confirmed";
type MeetingRow = {
  id: string;
  organizer: string;
  group_id: string;
  slots: Date[];
  minutes: number;
  status: Status;
  selected_slot: Date | null;
};
type Meeting = MeetingRow & { participants: string[] };

const denied = { status: "not_shareable" } as const;
const meetingId = z.object({ id: z.uuid() });

async function loadMeeting(db: PoolClient, id: string, me: string, lock = false) {
  const result = await db.query<Meeting>(`
    SELECT m.*, ARRAY(SELECT person_id FROM meeting_participants
                      WHERE meeting_id = m.id ORDER BY person_id) AS participants
    FROM meetings m
    WHERE m.id = $1 AND EXISTS (SELECT 1 FROM meeting_participants
                                WHERE meeting_id = m.id AND person_id = $2)
    ${lock ? "FOR UPDATE OF m" : ""}
  `, [id, me]);
  const meeting = result.rows[0];
  if (!meeting) return;
  const recipients = meeting.participants.filter(person => person !== meeting.organizer);
  if (await groupAllowed(db, meeting.organizer, recipients, meeting.group_id)) return meeting;
}

function view(meeting: Meeting) {
  return {
    id: meeting.id, organizer: meeting.organizer, participants: meeting.participants,
    minutes: meeting.minutes, status: meeting.status,
    ...(meeting.status === "collecting" && { slots: meeting.slots.map(slot => slot.toISOString()) }),
    ...(meeting.selected_slot && { slot: meeting.selected_slot.toISOString() }),
  };
}

async function answerFromCalendar(db: PoolClient, meeting: MeetingRow, me: string) {
  const freeSlots: string[] = [];
  for (const date of meeting.slots) {
    const slot = date.toISOString();
    const available = me === meeting.organizer
      ? await isFree(db, me, slot, meeting.minutes)
      : await readAvailability(db, meeting.organizer, me, meeting.group_id, slot, meeting.minutes);
    if (available === null) return false;
    if (available) freeSlots.push(slot);
  }
  await db.query(`UPDATE meeting_participants SET free_slots = $3
    WHERE meeting_id = $1 AND person_id = $2 AND free_slots IS NULL`, [meeting.id, me, freeSlots]);
  return true;
}

const propose = defineTool("meeting_propose", "Propose time options to members of a group.", z.object({
  recipients: z.array(personId).min(1),
  slots: z.array(z.iso.datetime({ offset: true })).min(1),
  minutes: z.number().int().min(1).max(1440),
  group: z.string().min(1),
}), async (db, me, { recipients, slots, minutes, group }) => {
  const others = [...new Set(recipients)].filter(person => person !== me);
  if (!others.length || !await groupAllowed(db, me, others, group)) return denied;
  const { rows } = await db.query<MeetingRow>(
    "INSERT INTO meetings (organizer, group_id, slots, minutes) VALUES ($1,$2,$3,$4) RETURNING *",
    [me, group, slots, minutes],
  );
  const meeting = rows[0];
  if (!meeting) throw new Error("Meeting could not be created");
  await db.query(`INSERT INTO meeting_participants (meeting_id, person_id)
    SELECT $1, unnest($2::text[])`, [meeting.id, [me, ...others]]);
  await answerFromCalendar(db, meeting, me);
  const current = await loadMeeting(db, meeting.id, me);
  return current ? view(current) : denied;
});

const inbox = defineTool("meeting_inbox", "List meetings awaiting your availability or decision.", z.object({}), async (db, me) => {
  const { rows } = await db.query<{ id: string }>(`
    SELECT m.id FROM meetings m JOIN meeting_participants p ON p.meeting_id = m.id
    WHERE p.person_id = $1 AND ((m.status = 'collecting' AND p.free_slots IS NULL)
                            OR (m.status = 'proposed' AND p.accepted IS NULL))
    ORDER BY m.id
  `, [me]);
  const meetings = [];
  for (const { id } of rows) {
    const meeting = await loadMeeting(db, id, me);
    if (meeting) meetings.push(view(meeting));
  }
  return { meetings };
});

const respond = defineTool("meeting_respond", "Check your calendar for a meeting in your inbox.", meetingId, async (db, me, { id }) => {
  const meeting = await loadMeeting(db, id, me, true);
  if (!meeting) return denied;
  if (meeting.status !== "collecting") return view(meeting);
  if (!await answerFromCalendar(db, meeting, me)) return denied;

  // Choose the first option in the organizer's order only once everyone has responded.
  await db.query(`
    WITH common AS (
      SELECT candidate FROM unnest($2::timestamptz[]) WITH ORDINALITY AS s(candidate, priority)
      WHERE NOT EXISTS (SELECT 1 FROM meeting_participants WHERE meeting_id = $1
                        AND NOT candidate = ANY(free_slots))
      ORDER BY priority LIMIT 1
    )
    UPDATE meetings SET selected_slot = (SELECT candidate FROM common),
      status = CASE WHEN EXISTS (SELECT 1 FROM common) THEN 'proposed' ELSE 'no_shared_slot' END
    WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM meeting_participants
                                  WHERE meeting_id = $1 AND free_slots IS NULL)
  `, [id, meeting.slots]);
  const current = await loadMeeting(db, id, me);
  return current ? view(current) : denied;
});

const get = defineTool("meeting_get", "Read a meeting and its shared outcome.", meetingId, async (db, me, { id }) => {
  const meeting = await loadMeeting(db, id, me);
  return meeting ? view(meeting) : denied;
});

const decide = defineTool("meeting_decide", "Accept or decline the proposed time for yourself.", meetingId.extend({
  accept: z.boolean(),
}), async (db, me, { id, accept }) => {
  const meeting = await loadMeeting(db, id, me, true);
  if (!meeting) return denied;
  if (meeting.status !== "proposed") return view(meeting);
  await db.query(`UPDATE meeting_participants SET accepted = $3
    WHERE meeting_id = $1 AND person_id = $2 AND accepted IS NULL`, [id, me, accept]);
  await db.query(`UPDATE meetings SET status = CASE
    WHEN EXISTS (SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND accepted IS FALSE) THEN 'declined'
    WHEN NOT EXISTS (SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND accepted IS NOT TRUE) THEN 'confirmed'
    ELSE 'proposed' END WHERE id = $1`, [id]);
  const current = await loadMeeting(db, id, me);
  return current ? view(current) : denied;
});

export const meetingTools = [propose, inbox, respond, get, decide];
