-- Versão leve para assistir (720p, H.264, ~3 Mbps, começa a tocar na hora). O original continua para baixar e publicar.
-- Ligada ao arquivo pelo storage_key: trocar o vídeo gera outra; a versão de um arquivo que saiu do sistema é apagada pela limpeza.
CREATE TABLE video_views (
  id SERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'original', 'erro')),
  view_key TEXT,
  size_bytes BIGINT,
  width INTEGER,
  height INTEGER,
  source_mbps NUMERIC(7,2),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
