CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer text NOT NULL REFERENCES people(id),
  group_id text NOT NULL,
  slots timestamptz[] NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  status text NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'no_shared_slot', 'proposed', 'declined', 'confirmed')),
  selected_slot timestamptz
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  -- NULL means this participant has yet to answer. An empty array means every option is busy.
  free_slots timestamptz[],
  accepted boolean,
  PRIMARY KEY (meeting_id, person_id)
);
CREATE INDEX IF NOT EXISTS meeting_participants_inbox ON meeting_participants(person_id, meeting_id);
