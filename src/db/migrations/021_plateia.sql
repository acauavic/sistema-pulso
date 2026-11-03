-- Pulso Podcast com Plateia: página pública de inscrição, agenda automática a partir dos convidados e medição.
ALTER TABLE guests ADD COLUMN audience_enabled BOOLEAN NOT NULL DEFAULT true;    -- aparece na agenda pública (desmarcar para tirar)
ALTER TABLE guests ADD COLUMN audience_status TEXT NOT NULL DEFAULT 'disponivel' CHECK (audience_status IN ('disponivel', 'lotado', 'encerrado'));
ALTER TABLE guests ADD COLUMN photo_key TEXT;                                      -- foto do convidado (Backblaze)

CREATE TABLE plateia_leads (
  id               SERIAL PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,                  -- código opaco que o navegador guarda até abrir o WhatsApp
  guest_id         INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  guest_name       TEXT NOT NULL,                         -- guardados aqui para o histórico sobreviver à edição/remoção do convidado
  recording_at     TIMESTAMPTZ,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,                         -- E.164, ex.: +5511999998888
  country          TEXT,
  price_cents      INTEGER,
  status           TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_atendimento', 'confirmado', 'desistiu')),
  notes            TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, fbclid TEXT, gclid TEXT,
  referrer         TEXT,
  landing_url      TEXT,
  visitor_id       TEXT,
  user_agent       TEXT,
  whatsapp_opened_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plateia_leads_guest_idx ON plateia_leads (guest_id);
CREATE INDEX plateia_leads_created_idx ON plateia_leads (created_at DESC);

CREATE TABLE plateia_events (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('view', 'agenda_click', 'signup_click', 'form_open', 'lead', 'whatsapp')),
  guest_id   INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  visitor_id TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  referrer   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plateia_events_created_idx ON plateia_events (created_at DESC);
CREATE INDEX plateia_events_type_idx ON plateia_events (type, created_at DESC);

INSERT INTO app_settings (key, value) VALUES
  ('plateia_active', 'true'),
  ('plateia_price_cents', '19700'),
  ('plateia_duration', '1h30 a 2h'),
  ('plateia_location', 'Estúdio do Pulso Podcast, Alphaville, SP'),
  ('plateia_whatsapp', ''),
  ('plateia_meta_pixel', ''),
  ('plateia_ga4', '')
ON CONFLICT DO NOTHING;
