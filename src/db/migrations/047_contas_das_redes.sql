-- Vigia das contas de redes sociais: guarda o estado de cada conta por provedor (ok, precisa reconectar, sumiu) e avisa a gestão
-- quando uma conta que já funcionou deixa de funcionar. Tipo de aviso novo: "integracao".
CREATE TABLE social_account_status (
  provider        TEXT NOT NULL,
  network         TEXT NOT NULL,
  handle          TEXT,
  account_id      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'reauth', 'sumiu')),
  since           TIMESTAMPTZ NOT NULL DEFAULT now(),   -- desde quando está neste estado
  last_ok_at      TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at     TIMESTAMPTZ,                          -- último aviso enviado
  notices         INTEGER NOT NULL DEFAULT 0,           -- quantos avisos nesta queda (para não insistir sem fim)
  PRIMARY KEY (provider, network)
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao'));
INSERT INTO notification_settings (type, roles) VALUES ('integracao', '{superadmin,gestao}') ON CONFLICT DO NOTHING;
