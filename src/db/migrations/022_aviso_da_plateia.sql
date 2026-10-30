-- Aviso de nova inscrição na plateia (a produtora precisa responder rápido).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro', 'plateia'));
INSERT INTO notification_settings (type, roles) VALUES ('plateia', '{superadmin,gestao,produtora}') ON CONFLICT DO NOTHING;

-- A plateia é escolhida pela produção: o pedido pode ser selecionado ou não.
ALTER TABLE plateia_leads DROP CONSTRAINT IF EXISTS plateia_leads_status_check;
ALTER TABLE plateia_leads ADD CONSTRAINT plateia_leads_status_check CHECK (status IN ('novo', 'em_atendimento', 'confirmado', 'nao_selecionado', 'desistiu'));
