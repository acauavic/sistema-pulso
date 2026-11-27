-- Material do patrocinador em pastas (Logos, Moldura, QR Code, Material da marca). Arquivos grandes (vídeo de inserção, manual da
-- marca) sobem pela mesma fila de envios dos episódios: em partes, direto ao Backblaze, retomando de onde pararam. Enquanto sobe, o
-- arquivo fica "enviando" e ninguém o vê fora da pasta. A logo principal é a que aparece no media kit e no portal do patrocinador.
ALTER TABLE sponsor_files ALTER COLUMN size_bytes TYPE BIGINT;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pronto';
ALTER TABLE sponsor_files DROP CONSTRAINT IF EXISTS sponsor_files_status_check;
ALTER TABLE sponsor_files ADD CONSTRAINT sponsor_files_status_check CHECK (status IN ('enviando', 'pronto'));
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS part_size INTEGER;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS upload_id TEXT;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS last_part_at TIMESTAMPTZ;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS replaces_id INTEGER;
ALTER TABLE sponsor_files ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sponsor_file_parts (
  file_id     INTEGER NOT NULL REFERENCES sponsor_files(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag        TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  PRIMARY KEY (file_id, part_number)
);

-- A logo de hoje (a mais nova de cada patrocinador) vira a principal.
UPDATE sponsor_files f SET is_main = true
 WHERE f.kind = 'logo' AND f.id = (SELECT max(x.id) FROM sponsor_files x WHERE x.sponsor_id = f.sponsor_id AND x.kind = 'logo')
   AND NOT EXISTS (SELECT 1 FROM sponsor_files y WHERE y.sponsor_id = f.sponsor_id AND y.kind = 'logo' AND y.is_main);
