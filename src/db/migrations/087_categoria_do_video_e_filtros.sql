-- Categoria de cada vídeo (corte, bastidor, trailer…): um dos tipos de vídeo de Gestão > Categorias. Os que já existem
-- herdam o tipo do pedido de conteúdo (quando é um tipo de vídeo) ou ficam como "Cortes do episódio".
ALTER TABLE episode_clips ADD COLUMN IF NOT EXISTS video_type TEXT;
UPDATE episode_clips c
   SET video_type = coalesce((SELECT r.kind FROM content_requests r JOIN video_types t ON t.key = r.kind WHERE r.id = c.request_id), 'cortes')
 WHERE video_type IS NULL;
ALTER TABLE episode_clips ALTER COLUMN video_type SET DEFAULT 'cortes';
ALTER TABLE episode_clips ALTER COLUMN video_type SET NOT NULL;
CREATE INDEX IF NOT EXISTS episode_clips_video_type_idx ON episode_clips (video_type);

-- Visualizações salvas dos filtros (Convidados e Conteúdo > Cortes): o endereço com os filtros, de quem salvou ou da equipe.
CREATE TABLE IF NOT EXISTS saved_filters (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL CHECK (entity IN ('guest', 'clip')),
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  shared     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_filters_idx ON saved_filters (entity, user_id);
