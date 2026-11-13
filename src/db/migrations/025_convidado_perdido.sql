-- CRM de convidados: "Recusou" vira "Perdido", com motivo obrigatório (e descrição quando o motivo é "Outros").
ALTER TABLE guests ADD COLUMN loss_reason TEXT
  CHECK (loss_reason IN ('recusado', 'sem_agenda', 'nunca_respondeu', 'parou_de_responder', 'conflito_de_interesse', 'outros'));
ALTER TABLE guests ADD COLUMN loss_note TEXT;

ALTER TABLE guests DROP CONSTRAINT guests_status_check;
UPDATE guests SET status = 'perdido', loss_reason = 'recusado', loss_note = rsvp_message WHERE status = 'recusou';
ALTER TABLE guests ADD CONSTRAINT guests_status_check
  CHECK (status IN ('prospect','convite_enviado','em_agendamento','agendado','gravado','perdido','cancelado'));
-- Perdido sempre tem motivo; "Outros" sempre tem descrição.
ALTER TABLE guests ADD CONSTRAINT guests_perdido_motivo_check
  CHECK (status <> 'perdido' OR (loss_reason IS NOT NULL AND (loss_reason <> 'outros' OR coalesce(btrim(loss_note), '') <> '')));

-- Saiu de Perdido (retomou contato, aceitou pelo convite…): o motivo antigo não vale mais.
CREATE FUNCTION guests_clear_loss() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'perdido' THEN NEW.loss_reason := NULL; NEW.loss_note := NULL; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER guests_clear_loss BEFORE INSERT OR UPDATE OF status ON guests FOR EACH ROW EXECUTE FUNCTION guests_clear_loss();
