-- Avisos das etapas do episódio (liberado para edição, enviado para revisão, ajustes pedidos, aprovado, publicado).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check
  CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio'));
INSERT INTO notification_settings (type, roles) VALUES ('episodio', '{}') ON CONFLICT DO NOTHING;
