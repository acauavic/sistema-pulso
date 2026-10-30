-- Portal do convidado: o material fica disponível por 60 dias a partir do primeiro envio do link (a equipe pode estender).
ALTER TABLE guests ADD COLUMN portal_expires_at TIMESTAMPTZ;
UPDATE guests SET portal_expires_at = portal_sent_at + interval '60 days' WHERE portal_sent_at IS NOT NULL;
