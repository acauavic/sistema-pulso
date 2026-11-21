-- Link do estúdio: o estúdio sobe o material da gravação direto para o episódio, por um link público (sem login).
-- Um link aberto por episódio; "Pedir reenvio" fecha o atual e cria outro. O token é a chave (como no convite e no portal).
CREATE TABLE episode_upload_links (
  id                SERIAL PRIMARY KEY,
  episode_id        INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  token             TEXT NOT NULL UNIQUE,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ,                      -- arquivo iniciado ou parte confirmada (7 dias sem uso fecha)
  first_upload_at   TIMESTAMPTZ,                      -- primeiro arquivo iniciado (aviso "o estúdio começou a enviar")
  finished_at       TIMESTAMPTZ,                      -- o estúdio clicou "Terminei o envio"
  closed_at         TIMESTAMPTZ,
  closed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  close_reason      TEXT CHECK (close_reason IN ('reenvio', 'fechado', 'expirado'))
);
CREATE UNIQUE INDEX episode_upload_links_open_idx ON episode_upload_links (episode_id) WHERE finished_at IS NULL AND closed_at IS NULL;
CREATE INDEX episode_upload_links_episode_idx ON episode_upload_links (episode_id, created_at DESC);

-- Arquivo enviado pelo link (só esse link enxerga e mexe nele) e o caminho relativo dentro da pasta que o estúdio arrastou
-- (câmeras repetem o nome do arquivo: CAM_A/C0001.MP4 e CAM_B/C0001.MP4).
ALTER TABLE episode_files ADD COLUMN upload_link_id INTEGER REFERENCES episode_upload_links(id) ON DELETE SET NULL;
ALTER TABLE episode_files ADD COLUMN source_path TEXT;
CREATE INDEX episode_files_upload_link_idx ON episode_files (upload_link_id) WHERE upload_link_id IS NOT NULL;
