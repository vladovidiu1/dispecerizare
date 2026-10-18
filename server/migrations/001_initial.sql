CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL,
 email text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','agent')),
 active boolean NOT NULL DEFAULT true, capacity integer NOT NULL DEFAULT 20 CHECK(capacity>0),
 available boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,email), UNIQUE(organization_id,id)
);
CREATE TABLE skills (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, UNIQUE(organization_id,name), UNIQUE(organization_id,id));
CREATE TABLE agent_skills (organization_id uuid NOT NULL, user_id uuid NOT NULL, skill_id uuid NOT NULL,
 PRIMARY KEY(user_id,skill_id), FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id));
CREATE TABLE classification_examples (id uuid PRIMARY KEY, organization_id uuid NOT NULL, skill_id uuid NOT NULL, subject text NOT NULL, body text NOT NULL, FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id));
CREATE TABLE mailboxes (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), provider text NOT NULL, address text NOT NULL, UNIQUE(organization_id,address), UNIQUE(organization_id,id));
CREATE TABLE messages (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 external_id text NOT NULL, thread_id text, sender_name text NOT NULL, sender_email text NOT NULL,
 subject text NOT NULL, body text NOT NULL, received_at timestamptz NOT NULL,
 skill_id uuid, assigned_to uuid, priority text NOT NULL DEFAULT 'Medie' CHECK(priority IN ('Scăzută','Medie','Ridicată')),
 status text NOT NULL DEFAULT 'Nou' CHECK(status IN ('Nou','În lucru','Rezolvat')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(mailbox_id,external_id), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,mailbox_id) REFERENCES mailboxes(organization_id,id),
 FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id),
 FOREIGN KEY(organization_id,assigned_to) REFERENCES users(organization_id,id)
);
CREATE INDEX messages_queue ON messages(organization_id,status,assigned_to,received_at DESC);
CREATE TABLE classifications (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, message_id uuid NOT NULL, skill_id uuid,
 confidence double precision CHECK(confidence>=0 AND confidence<=1), model text NOT NULL, prompt_version text NOT NULL, reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id), FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id)
);
CREATE TABLE message_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL, message_id uuid NOT NULL,
 actor_id uuid, actor_type text NOT NULL CHECK(actor_type IN ('user','robot','system')), type text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id), FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
);
CREATE INDEX events_message ON message_events(organization_id,message_id,id);
CREATE TABLE notes (id uuid PRIMARY KEY, organization_id uuid NOT NULL, message_id uuid NOT NULL, author_id uuid NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id), FOREIGN KEY(organization_id,author_id) REFERENCES users(organization_id,id));
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE api_keys (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
