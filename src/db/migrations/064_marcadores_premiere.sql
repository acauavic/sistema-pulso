-- Marcadores para o Premiere: a sequência do XML nasce no tamanho do vídeo do episódio (lido no envio, como os quadros por segundo).
ALTER TABLE episode_files ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE episode_files ADD COLUMN IF NOT EXISTS height INTEGER;
