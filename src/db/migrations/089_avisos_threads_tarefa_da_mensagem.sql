-- 1) Assunto do aviso: "prazo" (vence hoje, falta pouco, atrasada), "bloqueada" e "atribuida" (criou/atribuiu para você, mudou o prazo). Quando a tarefa vai para Fazendo ou Feito,
--    os não lidos desses assuntos ficam como lidos (services/notify.clearTopics).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS topic TEXT;
CREATE INDEX IF NOT EXISTS notifications_entity_topic_idx ON notifications (entity_type, entity_id, topic) WHERE read_at IS NULL AND topic IS NOT NULL;
-- os avisos que já estão no sino ganham o assunto pela chave (prazo) ou pelo título (bloqueio)
UPDATE notifications SET topic = 'prazo' WHERE topic IS NULL AND entity_type = 'task' AND dedupe_key ~ '^(late|due|soon)-';
UPDATE notifications SET topic = 'bloqueada' WHERE topic IS NULL AND entity_type = 'task' AND title LIKE 'Tarefa bloqueada:%';
UPDATE notifications SET topic = 'atribuida' WHERE topic IS NULL AND entity_type = 'task' AND (title LIKE '% criou uma tarefa para você:%' OR title LIKE 'Nova tarefa para você:%' OR title LIKE '% atribuiu uma tarefa a você:%' OR title LIKE '% mudou o prazo:%');

-- 2) Leitura de cada thread, por pessoa: o painel "Respostas não lidas" da conversa mostra as threads seguidas com resposta depois daqui.
CREATE TABLE IF NOT EXISTS chat_thread_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, parent_id)
);
-- o que já existe conta como lido (senão toda thread antiga apareceria como nova)
INSERT INTO chat_thread_reads (user_id, parent_id, last_read_id)
SELECT m.user_id, r.id, (SELECT max(x.id) FROM chat_messages x WHERE x.parent_id = r.id)
  FROM chat_messages r JOIN chat_members m ON m.conversation_id = r.conversation_id
 WHERE r.parent_id IS NULL AND r.reply_count > 0
ON CONFLICT DO NOTHING;

-- 3) Tarefa criada a partir de uma mensagem (ou da thread inteira): o link de volta e a linha "TAREFA · …" na mensagem.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_scope TEXT CHECK (source_scope IN ('mensagem', 'thread'));
CREATE INDEX IF NOT EXISTS tasks_source_message_idx ON tasks (source_message_id) WHERE source_message_id IS NOT NULL;
