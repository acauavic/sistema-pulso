-- Conteúdo fora do card do episódio: o editor SOBE os cortes (vários de uma vez), o sistema lê cada um e só depois ele é atribuído a um
-- episódio já gravado. Por isso corte, quadros e capas de corte podem existir sem episódio.
ALTER TABLE episode_clips DROP CONSTRAINT IF EXISTS episode_clips_check;
ALTER TABLE episode_clips DROP CONSTRAINT IF EXISTS episode_clips_status_check;
ALTER TABLE episode_clips DROP CONSTRAINT IF EXISTS episode_clips_source_check;
ALTER TABLE episode_clips ALTER COLUMN episode_id DROP NOT NULL;
ALTER TABLE episode_clips ALTER COLUMN start_ms DROP NOT NULL;
ALTER TABLE episode_clips ALTER COLUMN end_ms DROP NOT NULL;

-- o antigo fluxo "cortar do vídeo do episódio" acabou: sugestões sem vídeo somem; cortes que ficaram no meio viram erro
DELETE FROM episode_clips WHERE status = 'sugerido' AND storage_key IS NULL;
UPDATE episode_clips SET status = 'erro', error = coalesce(error, 'Corte interrompido pela mudança do fluxo; envie o vídeo de novo.') WHERE status IN ('sugerido', 'cortando');
ALTER TABLE episode_clips ADD CONSTRAINT episode_clips_status_check CHECK (status IN ('enviando', 'processando', 'pronto', 'erro'));
ALTER TABLE episode_clips ADD CONSTRAINT episode_clips_source_check CHECK (source IN ('ia', 'manual', 'upload'));

ALTER TABLE episode_clips
  ADD COLUMN post_title   TEXT,            -- título sugerido para as redes (o "title" é o nome interno: Corte 1, Corte 2…)
  ADD COLUMN filename     TEXT,
  ADD COLUMN content_type TEXT,
  ADD COLUMN upload_id    TEXT,            -- envio em partes em andamento
  ADD COLUMN part_size    INTEGER,
  ADD COLUMN transcript   TEXT,
  ADD COLUMN note         TEXT;            -- avisos que não são erro (ex.: vídeo horizontal)
ALTER TABLE episode_clips ALTER COLUMN source SET DEFAULT 'upload';

CREATE TABLE clip_upload_parts (
  clip_id     INTEGER NOT NULL REFERENCES episode_clips(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  PRIMARY KEY (clip_id, part_number)
);

ALTER TABLE episode_frames ALTER COLUMN episode_id DROP NOT NULL;
ALTER TABLE episode_covers ALTER COLUMN episode_id DROP NOT NULL;
CREATE INDEX episode_clips_episode_idx ON episode_clips (episode_id);
