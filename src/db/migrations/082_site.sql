-- Site do Pulso (podcastpulso.com): o sistema vira a fonte dos dados do site e recebe os formulários dele.
-- Convidado: estreia prevista (data do episódio ainda não marcado) e de onde veio o cadastro (origem + UTM do pedido pelo site).
-- Patrocinador: origem + UTM, "escondido do site" e "patrocinador oficial" (no máximo um).
ALTER TABLE guests ADD COLUMN IF NOT EXISTS premiere_on DATE;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS utm JSONB;

ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS utm JSONB;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS site_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS site_official BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS sponsors_site_official_one ON sponsors ((true)) WHERE site_official;
