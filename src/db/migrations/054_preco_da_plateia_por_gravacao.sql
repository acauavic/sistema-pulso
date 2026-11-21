-- Plateia: valor por gravação (episódio). Vazio = o valor geral de Plateia > Ajustes.
ALTER TABLE guests ADD COLUMN audience_price_cents BIGINT CHECK (audience_price_cents > 0);
