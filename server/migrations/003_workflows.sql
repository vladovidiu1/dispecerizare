ALTER TABLE messages ADD COLUMN resolved_at timestamptz;
ALTER TABLE messages ADD COLUMN task_kind text NOT NULL DEFAULT 'email' CHECK(task_kind IN ('email','emma'));
ALTER TABLE messages ADD COLUMN source_message_id uuid REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN emma_code text;
UPDATE messages SET resolved_at=updated_at WHERE status='Rezolvat';
CREATE INDEX messages_thread ON messages(mailbox_id,thread_id) WHERE thread_id IS NOT NULL;
CREATE TABLE mail_entries(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,message_id uuid NOT NULL,mailbox_id uuid NOT NULL,
 external_id text NOT NULL,internet_message_id text,thread_id text,sender_name text NOT NULL,sender_email text NOT NULL,
 subject text NOT NULL,body text NOT NULL,received_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(mailbox_id,external_id),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id),FOREIGN KEY(organization_id,mailbox_id) REFERENCES mailboxes(organization_id,id)
);
CREATE INDEX mail_entries_reference ON mail_entries(mailbox_id,internet_message_id);
INSERT INTO mail_entries SELECT id,organization_id,id,mailbox_id,external_id,NULL,thread_id,sender_name,sender_email,subject,body,received_at,created_at FROM messages;
CREATE TABLE attachments(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,message_id uuid NOT NULL,entry_id uuid NOT NULL,
 filename text NOT NULL,content_type text NOT NULL,size integer NOT NULL CHECK(size>=0),content bytea,unavailable_reason text,
 FOREIGN KEY(organization_id,message_id) REFERENCES messages(organization_id,id),FOREIGN KEY(organization_id,entry_id) REFERENCES mail_entries(organization_id,id)
);
ALTER TABLE users ADD COLUMN emma_codes text[] NOT NULL DEFAULT '{}';
CREATE TABLE emma_rules(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),sender_email text NOT NULL,
 subject_contains text NOT NULL DEFAULT '',sheet_name text NOT NULL,header_row integer NOT NULL DEFAULT 1 CHECK(header_row BETWEEN 1 AND 100),
 code_column text NOT NULL,skill_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 FOREIGN KEY(organization_id,skill_id) REFERENCES skills(organization_id,id),UNIQUE(organization_id,sender_email,subject_contains)
);
CREATE TABLE emma_imports(
 attachment_id uuid PRIMARY KEY REFERENCES attachments(id),organization_id uuid NOT NULL REFERENCES organizations(id),
 rule_id uuid REFERENCES emma_rules(id) ON DELETE SET NULL,state text NOT NULL CHECK(state IN ('done','failed')),created_tasks integer NOT NULL DEFAULT 0,
 ignored_rows integer NOT NULL DEFAULT 0,error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_documents(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),filename text NOT NULL,title text NOT NULL,
 sha256 text NOT NULL,content bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,sha256),UNIQUE(organization_id,id)
);
CREATE TABLE knowledge_chunks(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,document_id uuid NOT NULL,page integer NOT NULL,body text NOT NULL,
 FOREIGN KEY(organization_id,document_id) REFERENCES knowledge_documents(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX knowledge_search ON knowledge_chunks USING gin(to_tsvector('simple',body));

CREATE INDEX events_assignment_recency ON message_events(organization_id,(data->>'to'),created_at DESC) WHERE type='assigned';
