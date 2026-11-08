-- Revisão que não se perde: o comentário fica mesmo se a versão do vídeo sair (antes, apagar a versão apagava os comentários
-- junto); guarda a versão comentada; o editor marca o que corrigiu ("feito") e em qual versão a correção entrou.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'episode_comments'::regclass AND contype = 'f'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'episode_comments'::regclass AND attname = 'file_id')];
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE episode_comments DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE episode_comments ADD CONSTRAINT episode_comments_file_id_fkey FOREIGN KEY (file_id) REFERENCES episode_files(id) ON DELETE SET NULL;

ALTER TABLE episode_comments ADD COLUMN version INTEGER;              -- versão do vídeo em que a minutagem foi marcada
UPDATE episode_comments c SET version = f.version FROM episode_files f WHERE f.id = c.file_id;
ALTER TABLE episode_comments ADD COLUMN fixed_at TIMESTAMPTZ;          -- o editor marcou "feito"
ALTER TABLE episode_comments ADD COLUMN fixed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE episode_comments ADD COLUMN fixed_version INTEGER;         -- versão em que a correção entrou (nula = entra na próxima)

-- Quadros por segundo do vídeo editado (lido no envio): os marcadores para o programa de edição caem no quadro certo.
ALTER TABLE episode_files ADD COLUMN fps NUMERIC(7,3);
