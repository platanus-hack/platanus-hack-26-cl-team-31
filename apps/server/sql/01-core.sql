CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memberships (
  person_id text NOT NULL REFERENCES people(id),
  group_id text NOT NULL,
  can_ask boolean NOT NULL DEFAULT false,
  can_share boolean NOT NULL DEFAULT false,
  PRIMARY KEY (person_id, group_id)
);

CREATE TABLE IF NOT EXISTS busy_slots (
  person_id text NOT NULL REFERENCES people(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  title text NOT NULL,
  PRIMARY KEY (person_id, starts_at, ends_at)
);

CREATE TABLE IF NOT EXISTS availability_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester text NOT NULL REFERENCES people(id),
  recipient text NOT NULL REFERENCES people(id),
  group_id text NOT NULL,
  available boolean NOT NULL
);

CREATE OR REPLACE FUNCTION calendar_is_free(owner_id text, slot_start timestamptz, minutes integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM busy_slots
    WHERE person_id = owner_id
      AND starts_at < slot_start + minutes * interval '1 minute'
      AND ends_at > slot_start
  );
$$;

CREATE TABLE IF NOT EXISTS interests (
  person_id text NOT NULL REFERENCES people(id),
  interest text NOT NULL,
  audience text NOT NULL,
  PRIMARY KEY (person_id, interest, audience)
);
