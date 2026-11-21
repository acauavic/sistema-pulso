-- Aprovação por link: quem aprova pauta, roteiro, vídeo e capas está fora do sistema e só recebe um link.
-- Cada link vale para UMA versão (a cópia da pauta enviada, ou a versão do vídeo editado): mudou depois, o link antigo
-- deixa de aceitar resposta. Ninguém responde duas vezes ao mesmo link.

-- Uma cópia da pauta por envio (só quando o conteúdo mudou): é o que o link mostra e o que se compara no "o que mudou".
CREATE TABLE pauta_versions (
  id          SERIAL PRIMARY KEY,
  pauta_id    INTEGER NOT NULL REFERENCES pautas(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  body        TEXT,
  body_html   TEXT,
  link        TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pauta_id, n)
);

CREATE TABLE approval_links (
  id                SERIAL PRIMARY KEY,
  token             TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id),
  kind              TEXT NOT NULL CHECK (kind IN ('pauta', 'video', 'capas')),
  pauta_id          INTEGER REFERENCES pautas(id) ON DELETE CASCADE,
  pauta_version_id  INTEGER REFERENCES pauta_versions(id) ON DELETE CASCADE,
  episode_id        INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  file_id           INTEGER REFERENCES episode_files(id) ON DELETE SET NULL, -- a versão do vídeo editado que vai para aprovação
  sent_to           TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  answered_at       TIMESTAMPTZ,
  answer            TEXT CHECK (answer IN ('aprovado', 'ajustes')),
  answer_name       TEXT,
  answer_note       TEXT,
  CONSTRAINT approval_links_alvo_check CHECK (
    (kind = 'pauta' AND pauta_id IS NOT NULL AND pauta_version_id IS NOT NULL)
    OR (kind = 'video' AND episode_id IS NOT NULL AND file_id IS NOT NULL)
    OR (kind = 'capas' AND episode_id IS NOT NULL))
);
CREATE INDEX approval_links_pauta_idx ON approval_links (pauta_id) WHERE pauta_id IS NOT NULL;
CREATE INDEX approval_links_episode_idx ON approval_links (episode_id) WHERE episode_id IS NOT NULL;

-- Comentário de quem está de fora (pelo link): sem usuário, com o nome que a pessoa escreveu.
ALTER TABLE episode_comments ADD COLUMN external_name TEXT;
ALTER TABLE episode_comments ADD COLUMN approval_link_id INTEGER REFERENCES approval_links(id) ON DELETE SET NULL;

-- Aviso novo: a resposta que veio pelo link.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site', 'redes', 'aprovacao'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site', 'redes', 'aprovacao'));
INSERT INTO notification_settings (type, roles) VALUES ('aprovacao', '{}') ON CONFLICT DO NOTHING;
