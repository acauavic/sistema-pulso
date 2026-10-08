-- Gestão do podcast Pulso — schema inicial

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT,                       -- null = ainda não definiu senha (convite pendente)
  role          TEXT NOT NULL CHECK (role IN ('superadmin','gestao','produtora','editor_video')),
  active        BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,              -- sha256 do cookie; o token cru nunca vai pro banco
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  flash      JSONB,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_tokens (                  -- links de "definir senha" e "esqueci a senha"
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id);

CREATE TABLE invite_templates (             -- modelos de HTML do convite
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT 'Convite para o {{podcast}}',
  html_body  TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invite_templates_one_default ON invite_templates (is_default) WHERE is_default;

CREATE TABLE guests (                       -- convidados (o "CRM")
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  instagram            TEXT,
  company              TEXT,
  job_title            TEXT,
  bio                  TEXT,
  topic                TEXT,                -- tema/pauta do episódio
  proposed_at          TIMESTAMPTZ,         -- data/hora sugerida da gravação
  status               TEXT NOT NULL DEFAULT 'prospect'
                       CHECK (status IN ('prospect','convite_enviado','confirmado','gravado','publicado','recusou','cancelado')),
  owner_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  template_id          INTEGER REFERENCES invite_templates(id) ON DELETE SET NULL,
  notes                TEXT,
  invite_token         TEXT UNIQUE,         -- parte secreta do link público /convite/:token
  short_url            TEXT,                -- link curto gerado no YOURLS
  short_keyword        TEXT,
  invite_generated_at  TIMESTAMPTZ,
  invite_sent_at       TIMESTAMPTZ,
  invite_viewed_at     TIMESTAMPTZ,
  responded_at         TIMESTAMPTZ,
  rsvp_message         TEXT,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guests_status_idx ON guests (status);
CREATE INDEX guests_owner_idx ON guests (owner_id);

CREATE TABLE guest_events (                 -- linha do tempo de cada convidado
  id         SERIAL PRIMARY KEY,
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,                 -- criado | status | nota | convite_gerado | convite_enviado | convite_visto | resposta
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guest_events_guest_idx ON guest_events (guest_id, created_at DESC);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
