-- Preserve all AI classifications/examples and the former processing_jobs as history.
ALTER TABLE messages DROP CONSTRAINT messages_tag_source_check;
ALTER TABLE messages ADD CONSTRAINT messages_tag_source_check CHECK(tag_source IN ('ai','human','rule'));
CREATE TABLE dispatch_rules(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),name text NOT NULL,
 priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 10000),enabled boolean NOT NULL DEFAULT false,
 match_mode text NOT NULL CHECK(match_mode IN ('all','any')),conditions jsonb NOT NULL,
 skill_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id),UNIQUE(organization_id,id)
);
CREATE TABLE dispatch_jobs(
 message_id uuid PRIMARY KEY,organization_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','done','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id)
);
CREATE INDEX dispatch_jobs_ready ON dispatch_jobs(state,next_attempt_at);
INSERT INTO dispatch_jobs(message_id,organization_id)
 SELECT m.id,m.organization_id FROM messages m JOIN processing_jobs j ON j.message_id=m.id
 WHERE m.status='Nou' AND m.assigned_to IS NULL AND m.tag_source IS DISTINCT FROM 'human' AND m.task_kind='email' AND j.state IN ('pending','retry','running');
CREATE TABLE rule_decisions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,message_id uuid NOT NULL,rule_id uuid,skill_id uuid,
 outcome text NOT NULL CHECK(outcome IN ('matched','no_match','ambiguous')),detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id),
 FOREIGN KEY(organization_id,rule_id) REFERENCES dispatch_rules(organization_id,id) ON DELETE SET NULL (rule_id),
 FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id)
);
CREATE TABLE task_resolutions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,message_id uuid NOT NULL,author_id uuid NOT NULL,
 summary text NOT NULL,steps text NOT NULL,shareable boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id),
 FOREIGN KEY(organization_id,author_id) REFERENCES users(organization_id,id)
);
CREATE INDEX resolution_search ON task_resolutions USING gin(to_tsvector('simple',summary||' '||steps)) WHERE shareable;
ALTER TABLE mail_entries ADD COLUMN direction text NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound','outbound'));
CREATE TABLE sender_accounts(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,user_id uuid NOT NULL UNIQUE,
 provider text NOT NULL CHECK(provider IN ('outlook','gmail','yahoo')),address text NOT NULL,
 encrypted_credentials text,revision integer NOT NULL DEFAULT 1,last_error text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),UNIQUE(organization_id,id)
);
CREATE TABLE outgoing_mail(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,message_id uuid NOT NULL,actor_id uuid NOT NULL,sender_account_id uuid NOT NULL,
 sender_revision integer NOT NULL,request_id uuid NOT NULL,original_entry_id uuid NOT NULL,
 from_address text NOT NULL,to_address text NOT NULL,reply_to_address text NOT NULL,subject text NOT NULL,body text NOT NULL,
 internet_message_id text NOT NULL,in_reply_to text NOT NULL,reference_ids jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','failed','unknown','cancelled')),
 last_error text,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,sender_account_id) REFERENCES sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,original_entry_id) REFERENCES mail_entries(organization_id,id),
 UNIQUE(organization_id,actor_id,request_id),UNIQUE(organization_id,internet_message_id)
);
CREATE INDEX outgoing_mail_ready ON outgoing_mail(state,created_at);
