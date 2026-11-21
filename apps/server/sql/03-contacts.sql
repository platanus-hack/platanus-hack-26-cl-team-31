-- A private, one-way address book. Saving an address never requires the target to publish a profile.
CREATE TABLE IF NOT EXISTS contacts (
  owner_id text NOT NULL REFERENCES people(id),
  contact_id text NOT NULL,
  PRIMARY KEY (owner_id, contact_id),
  CHECK (owner_id <> contact_id)
);
