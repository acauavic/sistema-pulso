-- Pedidos de conteúdo: trabalho para o editor que nem sempre é de um episódio (trailer do canal, vídeo avulso, post, story…).
-- A entrega vira corte (vídeo, em episode_clips) ou imagem (em episode_covers, kind 'entrega'); só entra no Social depois de aprovada.
CREATE TABLE content_requests (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('trailer', 'video', 'corte', 'post', 'carrossel', 'story', 'outro')),
  title         TEXT NOT NULL,
  briefing      TEXT,                                   -- texto puro (busca, avisos)
  briefing_html TEXT,                                   -- HTML já limpo (lista branca)
  format        TEXT CHECK (format IN ('vertical', 'horizontal', 'quadrado')),
  episode_id    INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  assignee_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  due_on        DATE,
  status        TEXT NOT NULL DEFAULT 'pedido' CHECK (status IN ('pedido', 'producao', 'revisao', 'aprovado', 'cancelado')),
  rounds        INTEGER NOT NULL DEFAULT 0,             -- quantas vezes voltou com ajustes
  review_note   TEXT,                                   -- o que pedir de ajuste na última volta
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  delivered_at  TIMESTAMPTZ,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX content_requests_status_idx ON content_requests (status, due_on);
CREATE INDEX content_requests_assignee_idx ON content_requests (assignee_id) WHERE status IN ('pedido', 'producao');

ALTER TABLE episode_clips ADD COLUMN request_id INTEGER REFERENCES content_requests(id) ON DELETE SET NULL;
CREATE INDEX episode_clips_request_idx ON episode_clips (request_id) WHERE request_id IS NOT NULL;
ALTER TABLE episode_covers ADD COLUMN request_id INTEGER REFERENCES content_requests(id) ON DELETE CASCADE;
CREATE INDEX episode_covers_request_idx ON episode_covers (request_id) WHERE request_id IS NOT NULL;
ALTER TABLE episode_covers DROP CONSTRAINT IF EXISTS episode_covers_kind_check;
ALTER TABLE episode_covers ADD CONSTRAINT episode_covers_kind_check CHECK (kind IN ('youtube_thumb', 'reel_cover', 'post_quote', 'post_split', 'carousel', 'entrega'));

-- Publicação de conteúdo avulso (trailer do canal): sem episódio.
ALTER TABLE episode_publications ALTER COLUMN episode_id DROP NOT NULL;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_entity_type_check;
ALTER TABLE comments ADD CONSTRAINT comments_entity_type_check CHECK (entity_type IN ('guest', 'sponsor', 'episode', 'task', 'clip', 'content_request'));
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check CHECK (entity_type IN ('task', 'comment', 'review', 'content_request'));
