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

-- Aviso novo: "site" (alguém pediu para ser convidado ou patrocinar pelo site). Vai para a gestão por padrão.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem', 'site'));
INSERT INTO notification_settings (type, roles) VALUES ('site', '{superadmin,gestao}') ON CONFLICT DO NOTHING;
