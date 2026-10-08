-- Riyaz Connect schema. Idempotent: safe to run on every boot.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event             TEXT        NOT NULL,
  source            TEXT        NOT NULL DEFAULT 'self'  CHECK (source IN ('self', 'manual')),
  full_name         TEXT        NOT NULL,
  company           TEXT,
  role              TEXT,
  email             TEXT,
  phone             TEXT,
  linkedin          TEXT,
  interests         TEXT[]      NOT NULL DEFAULT '{}',
  challenge         TEXT,
  timeline          TEXT        CHECK (timeline IN ('now', 'quarter', 'exploring')),
  preferred_channel TEXT        CHECK (preferred_channel IN ('whatsapp', 'email', 'linkedin', 'call')),
  referral          TEXT,
  consent           BOOLEAN     NOT NULL DEFAULT FALSE,
  score             INTEGER     NOT NULL DEFAULT 0,
  warmth            TEXT        NOT NULL DEFAULT 'cold' CHECK (warmth IN ('hot', 'warm', 'cold')),
  status            TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'contacted', 'meeting', 'client', 'archived')),
  notes             TEXT,
  follow_up_on      DATE,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One record per person per event, keyed on email when one is given.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_event_email_uniq
  ON contacts (event, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_created_idx   ON contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_follow_up_idx ON contacts (follow_up_on) WHERE status <> 'archived';

-- Photo taken together at the event, and delivery of it to the contact's WhatsApp.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo                 BYTEA;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo_mime            TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo_token           TEXT UNIQUE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo_whatsapp_status TEXT
  CHECK (photo_whatsapp_status IN ('pending', 'sent', 'failed', 'manual'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo_whatsapp_error  TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo_sent_at         TIMESTAMPTZ;
