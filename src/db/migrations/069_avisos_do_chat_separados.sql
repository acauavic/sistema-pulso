-- Mensagens deixam de ser Notificações do sistema: o aviso de conversa, menção, reação e "adicionou você ao grupo" vai para o
-- celular (push), para o aviso flutuante com som e para o contador de Mensagens, e não entra mais na lista do sino.
-- chat_alerts guarda o que já foi avisado (a mesma chave não avisa duas vezes) e alimenta o push; some depois de 30 dias.
CREATE TABLE chat_alerts (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key  TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX chat_alerts_created_idx ON chat_alerts (created_at);

-- Quem tinha silenciado "Mensagens" no sino continua sem aviso: as conversas dela ficam em "nenhum" (a pessoa muda em cada conversa).
UPDATE chat_members cm SET notify = 'nada'
  WHERE cm.notify IS NULL AND cm.left_at IS NULL
    AND EXISTS (SELECT 1 FROM notification_mutes nm WHERE nm.user_id = cm.user_id AND nm.type = 'mensagem');
DELETE FROM notification_mutes WHERE type = 'mensagem';
DELETE FROM notification_settings WHERE type = 'mensagem';
-- os avisos de mensagem que estavam no sino saem (a conversa continua com o contador de não lidas)
DELETE FROM notifications WHERE type = 'mensagem';
