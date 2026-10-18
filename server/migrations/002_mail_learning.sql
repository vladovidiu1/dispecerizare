ALTER TABLE messages ADD COLUMN tag_source text CHECK(tag_source IN ('ai','human'));
ALTER TABLE messages ADD COLUMN tag_confirmed_by uuid;
ALTER TABLE messages ADD COLUMN tag_confirmed_at timestamptz;
ALTER TABLE messages ADD CONSTRAINT messages_confirmer_fk FOREIGN KEY(organization_id,tag_confirmed_by) REFERENCES users(organization_id,id);
UPDATE messages SET tag_source='ai' WHERE skill_id IS NOT NULL;
UPDATE messages m SET tag_source='human', tag_confirmed_by=e.actor_id,tag_confirmed_at=e.created_at FROM (SELECT DISTINCT ON(message_id) message_id,actor_id,created_at FROM message_events WHERE data->>'field'='skillId' AND actor_type='user' ORDER BY message_id,id DESC) e WHERE m.id=e.message_id;
CREATE INDEX confirmed_message_search ON messages USING gin(to_tsvector('simple',subject||' '||body)) WHERE tag_source='human' AND skill_id IS NOT NULL;
CREATE INDEX example_search ON classification_examples USING gin(to_tsvector('simple',subject||' '||body));
CREATE TABLE mailbox_connections(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,mailbox_id uuid NOT NULL UNIQUE,
 provider text NOT NULL CHECK(provider IN ('outlook','gmail','yahoo')),encrypted_credentials text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,initial_days integer NOT NULL DEFAULT 1 CHECK(initial_days BETWEEN 1 AND 90),
 poll_seconds integer NOT NULL DEFAULT 60 CHECK(poll_seconds BETWEEN 30 AND 3600),
 sync_state jsonb NOT NULL DEFAULT '{}',last_synced_at timestamptz,last_attempt_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,mailbox_id) REFERENCES mailboxes(organization_id,id),UNIQUE(organization_id,id)
);
CREATE TABLE processing_jobs(
 message_id uuid PRIMARY KEY,organization_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','done','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id)
);
CREATE INDEX processing_jobs_ready ON processing_jobs(state,next_attempt_at);
