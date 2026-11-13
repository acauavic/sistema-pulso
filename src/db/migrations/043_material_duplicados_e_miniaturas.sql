-- Envio de material: substituir um arquivo já enviado (o antigo sai quando o novo termina), saber quando chegou a última
-- parte (envio parado = "não terminou") e miniaturas/visualização para a galeria (chaves no bucket por tamanho).
ALTER TABLE episode_files ADD COLUMN replaces_id INTEGER;
ALTER TABLE episode_files ADD COLUMN last_part_at TIMESTAMPTZ;
ALTER TABLE episode_files ADD COLUMN preview_keys JSONB NOT NULL DEFAULT '{}'::jsonb;
