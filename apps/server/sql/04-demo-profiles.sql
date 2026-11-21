-- Local demo directory. Interest values stay in each owner's private file.
CREATE TABLE IF NOT EXISTS demo_profiles (
  person_id text PRIMARY KEY REFERENCES people(id),
  display_name text NOT NULL,
  interest_readers text[] NOT NULL
);
