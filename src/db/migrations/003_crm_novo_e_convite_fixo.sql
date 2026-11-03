-- CRM novo: perfil, motivo, posicionamento, confirmações de agenda e links publicados.
-- Etapas: "confirmado" vira "em_agendamento" e entra "agendado". O convite passa a ser um modelo fixo
-- (arquivo no código), então some a tabela de modelos. Cliques nos botões do convite são registrados aqui.
ALTER TABLE guests DROP CONSTRAINT guests_status_check;
UPDATE guests SET status = 'em_agendamento' WHERE status = 'confirmado';
ALTER TABLE guests ADD CONSTRAINT guests_status_check
  CHECK (status IN ('prospect','convite_enviado','em_agendamento','agendado','gravado','publicado','recusou','cancelado'));

ALTER TABLE guests
  ADD COLUMN profile          TEXT CHECK (profile IN ('medico','influencer','empresario','profissional_saude')),
  ADD COLUMN invite_reason    TEXT,                          -- motivo do convite
  ADD COLUMN positioning      TEXT,                          -- posicionamento
  ADD COLUMN scheduled_studio BOOLEAN NOT NULL DEFAULT false, -- agenda confirmada no Estúdio
  ADD COLUMN scheduled_hosts  BOOLEAN NOT NULL DEFAULT false, -- agenda confirmada com os hosts
  ADD COLUMN scheduled_guest  BOOLEAN NOT NULL DEFAULT false, -- agenda confirmada com o convidado
  ADD COLUMN youtube_url      TEXT,
  ADD COLUMN spotify_url      TEXT;

ALTER TABLE guests DROP COLUMN template_id;
DROP TABLE invite_templates;

CREATE TABLE invite_clicks (               -- cliques humanos nos botões da página do convite
  id         BIGSERIAL PRIMARY KEY,
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('aceitar','producao')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invite_clicks_guest_idx ON invite_clicks (guest_id, kind);
