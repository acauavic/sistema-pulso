-- Cadência de abordagem: registro de cada contato (por canal e endereço), follow-ups, meta diária de patrocinadores.

-- Desde quando o convidado/patrocinador está na etapa atual (a cadência conta a partir daí). Um gatilho mantém o valor em qualquer
-- caminho que mude a etapa (quadro, formulário, edição em massa, convite público…).
ALTER TABLE guests ADD COLUMN stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sponsors ADD COLUMN stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE guests g SET stage_entered_at = COALESCE((SELECT max(e.created_at) FROM guest_events e WHERE e.guest_id = g.id AND e.type = 'status'), g.invite_sent_at, g.updated_at);
UPDATE sponsors SET stage_entered_at = updated_at;

CREATE FUNCTION guests_stage_entered() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.stage_entered_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER guests_stage_entered BEFORE UPDATE OF status ON guests FOR EACH ROW EXECUTE FUNCTION guests_stage_entered();

CREATE FUNCTION sponsors_stage_entered() RETURNS trigger AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN NEW.stage_entered_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sponsors_stage_entered BEFORE UPDATE OF stage ON sponsors FOR EACH ROW EXECUTE FUNCTION sponsors_stage_entered();

-- Uma linha por abordagem. "enviado" = a pessoa mandou mensagem/ligou; "respondeu" = o outro lado respondeu (encerra a cadência).
-- Sem chave estrangeira no assunto: guest e sponsor são tabelas diferentes (o histórico some junto pelo apagar do próprio assunto).
CREATE TABLE outreach_attempts (
  id           SERIAL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('guest', 'sponsor')),
  subject_id   INTEGER NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('instagram', 'email', 'whatsapp', 'telefone', 'outro')),
  address      TEXT,                                   -- qual @, e-mail ou número foi usado (um convidado pode ter vários)
  result       TEXT NOT NULL DEFAULT 'enviado' CHECK (result IN ('enviado', 'respondeu')),
  note         TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),     -- quando aconteceu (dá para registrar depois)
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outreach_subject_idx ON outreach_attempts (subject_type, subject_id, at DESC);
CREATE INDEX outreach_user_idx ON outreach_attempts (user_id, at DESC);
CREATE INDEX outreach_at_idx ON outreach_attempts (at DESC);

-- Meta diária de abordagens de patrocinadores por pessoa (sobrescreve o padrão da gestão; 0 = sem meta).
CREATE TABLE outreach_goals (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_target INTEGER NOT NULL CHECK (daily_target >= 0 AND daily_target <= 200),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aviso diário de follow-ups.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia'));
INSERT INTO notification_settings (type, roles) VALUES ('cadencia', '{}') ON CONFLICT DO NOTHING;

-- Apagou o convidado/patrocinador: o histórico de abordagens vai junto.
CREATE FUNCTION outreach_forget() RETURNS trigger AS $$
BEGIN
  DELETE FROM outreach_attempts WHERE subject_type = TG_ARGV[0] AND subject_id = OLD.id;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER guests_outreach_forget AFTER DELETE ON guests FOR EACH ROW EXECUTE FUNCTION outreach_forget('guest');
CREATE TRIGGER sponsors_outreach_forget AFTER DELETE ON sponsors FOR EACH ROW EXECUTE FUNCTION outreach_forget('sponsor');
