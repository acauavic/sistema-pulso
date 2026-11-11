-- Reuniões com patrocinador: marcadas no cadastro, criadas no Google Agenda do Pulso em nome da conta do Workspace (o Google manda o
-- convite e cria o Meet). A volta do Google (horário, Meet criado lá, respostas, cancelamento) atualiza esta tabela a cada 15 min.
-- O resumo chega depois (à mão hoje; por webhook numa próxima etapa). Ver services/sponsorMeetings.js.
CREATE TABLE sponsor_meetings (
  id              SERIAL PRIMARY KEY,
  sponsor_id      INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  agenda          TEXT,
  starts_at       TIMESTAMPTZ NOT NULL,
  minutes         INTEGER NOT NULL DEFAULT 45 CHECK (minutes BETWEEN 15 AND 240),
  mode            TEXT NOT NULL DEFAULT 'meet' CHECK (mode IN ('meet', 'presencial')),
  location        TEXT,
  meet_url        TEXT,
  attendees       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- convidados de fora: [{ email, response }]
  owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  team_ids        UUID[] NOT NULL DEFAULT '{}',          -- mais gente da equipe (além do responsável)
  status          TEXT NOT NULL DEFAULT 'marcada' CHECK (status IN ('marcada', 'cancelada')),
  google_event_id TEXT,
  google_state    TEXT NOT NULL DEFAULT 'pendente' CHECK (google_state IN ('pendente', 'ok', 'erro')),
  google_error    TEXT,
  synced_at       TIMESTAMPTZ,
  summary         TEXT,
  summary_source  TEXT CHECK (summary_source IN ('manual', 'webhook')),
  summary_at      TIMESTAMPTZ,
  summary_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_meetings_sponsor_idx ON sponsor_meetings (sponsor_id, starts_at DESC);
CREATE INDEX sponsor_meetings_upcoming_idx ON sponsor_meetings (starts_at) WHERE status = 'marcada';
