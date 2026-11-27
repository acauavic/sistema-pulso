-- Portal do convidado: a equipe pode liberar o download do vídeo do episódio (desligado por padrão).
ALTER TABLE guests ADD COLUMN portal_video BOOLEAN NOT NULL DEFAULT false;
-- Link de parceiro: logomarca que aparece no convite, na página de inscrição da plateia.
ALTER TABLE plateia_partners ADD COLUMN logo_key TEXT;
