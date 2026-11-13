-- Lembretes da gravação (a produtora manda pelo WhatsApp) e aviso quando o convidado responde ao convite.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete'));
INSERT INTO notification_settings (type, roles) VALUES
  ('convite', '{superadmin,gestao,produtora}'), ('lembrete', '{produtora}') ON CONFLICT DO NOTHING;

-- Um lembrete por tipo e convidado: d3 (3 dias antes), d1 (1 dia antes), dia (manhã do dia), h3 (3 horas antes).
-- recording_at guarda a data da gravação para a qual o lembrete foi feito: remarcou, refaz.
CREATE TABLE guest_reminders (
  id           BIGSERIAL PRIMARY KEY,
  guest_id     INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('d3', 'd1', 'dia', 'h3')),
  due_at       TIMESTAMPTZ NOT NULL,
  recording_at TIMESTAMPTZ NOT NULL,
  notified_at  TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  sent_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, kind)
);
CREATE INDEX guest_reminders_due_idx ON guest_reminders (due_at) WHERE sent_at IS NULL AND notified_at IS NULL;
