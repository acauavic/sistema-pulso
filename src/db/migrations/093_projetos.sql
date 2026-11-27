-- Projetos: o sistema deixa de ser de um podcast só. Tudo o que existe vira do Pulso; o Projeto 100 nasce vazio.
-- Regra: cadastro é da casa, trabalho e dinheiro são sempre de um projeto (docs/superpowers/specs/2026-11-20-multiprojetos-design.md).

CREATE TABLE projects (
  id                 SERIAL PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  sigla              TEXT NOT NULL UNIQUE CHECK (sigla ~ '^[A-Z0-9]{2,6}$'), -- aparece em mono entre colchetes nos cartões: [ P100 ]
  video_label        TEXT NOT NULL DEFAULT 'Episódio',   -- como o projeto chama os seus vídeos
  video_label_plural TEXT NOT NULL DEFAULT 'Episódios',
  number_prefix      TEXT NOT NULL DEFAULT 'EP.',        -- EP.012, V.003
  default_format     TEXT NOT NULL DEFAULT 'podcast' CHECK (default_format IN ('podcast', 'video')),
  modules            JSONB NOT NULL DEFAULT '{}',         -- o que o projeto usa: { "convidados": true, "plateia": true, … }
  public_host        TEXT,                                -- domínio dos links públicos do projeto (fase dos endereços)
  short_link_host    TEXT,
  mail_from_name     TEXT,
  mail_from_address  TEXT,
  active             BOOLEAN NOT NULL DEFAULT true,
  position           INTEGER NOT NULL DEFAULT 0,          -- o ativo de menor posição é o projeto padrão
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO projects (id, slug, name, sigla, video_label, video_label_plural, number_prefix, default_format, modules, position) VALUES
  (1, 'pulso', 'Pulso', 'PULSO', 'Episódio', 'Episódios', 'EP.', 'podcast',
   '{"convidados": true, "patrocinio": true, "producao": true, "convites": true, "portal": true, "plateia": true, "media_kit": true, "redes": true, "financeiro": true, "tarefas": true}', 1),
  (2, 'projeto-100', 'Projeto 100', 'P100', 'Vídeo', 'Vídeos', 'V.', 'video', '{"tarefas": true}', 2);
SELECT setval(pg_get_serial_sequence('projects', 'id'), 2);

-- Onde cada pessoa trabalha. `finance` é o interruptor "Vê o financeiro" naquele projeto (além do perfil).
CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  finance    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

ALTER TABLE users ADD COLUMN house BOOLEAN NOT NULL DEFAULT true;                                  -- equipe da casa (alcança o que é geral)
ALTER TABLE users ADD COLUMN last_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;   -- recorte escolhido no menu; vazio = todos

-- Quem está no sistema hoje entra no Pulso; os superadmins entram também no Projeto 100 e marcam quem mais trabalha nele.
INSERT INTO project_members (project_id, user_id, finance) SELECT 1, id, true FROM users;
INSERT INTO project_members (project_id, user_id, finance) SELECT 2, id, true FROM users WHERE role = 'superadmin';

DO $$
DECLARE t TEXT;
BEGIN
  -- raízes: sempre de um projeto. O padrão (Pulso) é rede de segurança; o código informa o projeto em toda criação.
  FOREACH t IN ARRAY ARRAY['guests', 'sponsors', 'episodes', 'episode_clips', 'content_requests', 'social_ideas', 'sponsor_plans', 'plateia_events'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1 REFERENCES projects(id)', t);
    EXECUTE format('CREATE INDEX %I ON %I (project_id)', t || '_project_idx', t);
  END LOOP;
  -- pode ser de um projeto ou geral (vazio). O que já existe é do Pulso.
  FOREACH t IN ARRAY ARRAY['tasks', 'task_routines', 'user_goals', 'audit_log', 'trash_items'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN project_id INTEGER REFERENCES projects(id)', t);
    EXECUTE format('UPDATE %I SET project_id = 1', t);
    EXECUTE format('CREATE INDEX %I ON %I (project_id)', t || '_project_idx', t);
  END LOOP;
END $$;
