-- Portal do convidado: uma página por convidado (link com token) que vai se enchendo durante a semana do episódio:
-- cronograma, posts em collab e sobre ele, cortes exclusivos para ele postar, links do episódio e fotos escolhidas.
ALTER TABLE guests
  ADD COLUMN portal_token        TEXT UNIQUE,
  ADD COLUMN portal_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN portal_cuts_from    DATE,          -- quando os cortes começam (vazio = segunda da semana em que o episódio sai)
  ADD COLUMN portal_release_on   DATE,          -- quando o episódio sai (vazio = data de veiculação do episódio)
  ADD COLUMN portal_exclusive_from DATE,        -- quando os cortes exclusivos aparecem (vazio = no dia em que o episódio sai)
  ADD COLUMN portal_notify       TEXT NOT NULL DEFAULT 'auto' CHECK (portal_notify IN ('auto', 'email', 'whatsapp', 'nenhum')),
  ADD COLUMN portal_yt_channel   TEXT,          -- canal do YouTube para o episódio sair em collab
  ADD COLUMN portal_yt_requested_at TIMESTAMPTZ,
  ADD COLUMN portal_yt_done_at   TIMESTAMPTZ,
  ADD COLUMN portal_sent_at      TIMESTAMPTZ;   -- quando o link foi mandado pela primeira vez

-- Corte que não foi publicado é, por padrão, exclusivo do convidado. A equipe pode tirar um do portal.
ALTER TABLE episode_clips ADD COLUMN for_guest BOOLEAN NOT NULL DEFAULT true;
-- Fotos do material do episódio que vão para o portal (a equipe escolhe).
ALTER TABLE episode_files ADD COLUMN for_guest BOOLEAN NOT NULL DEFAULT false;

-- Avisos ao convidado de cada post novo em collab (um por publicação). E-mail sai sozinho; WhatsApp fica pendente até a equipe mandar.
CREATE TABLE guest_portal_notices (
  id             SERIAL PRIMARY KEY,
  guest_id       INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  publication_id INTEGER NOT NULL REFERENCES episode_publications(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'nenhum')),
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, publication_id)
);
CREATE INDEX guest_portal_notices_pending ON guest_portal_notices (guest_id) WHERE sent_at IS NULL;
