-- Mensagens da equipe: conversas individuais e grupos, respostas em thread, reações e entrega garantida.
-- rev: contador por conversa, aumentado com a linha travada; quem esteve desconectado pede "tudo depois da rev N" e não perde nada.
-- client_id: código criado pelo navegador; reenviar a mesma mensagem nunca gera outra.
CREATE TABLE chat_conversations (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  name TEXT,
  direct_key TEXT UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rev BIGINT NOT NULL DEFAULT 0,
  last_message_id BIGINT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'direct' AND direct_key IS NOT NULL) OR (kind = 'group' AND name IS NOT NULL))
);

CREATE TABLE chat_members (
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  notified_upto BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX chat_members_user_idx ON chat_members (user_id) WHERE left_at IS NULL;

CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id UUID NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  rev BIGINT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (author_id, client_id)
);
CREATE INDEX chat_messages_conv_idx ON chat_messages (conversation_id, id);
CREATE INDEX chat_messages_conv_rev_idx ON chat_messages (conversation_id, rev);
CREATE INDEX chat_messages_parent_idx ON chat_messages (parent_id, id) WHERE parent_id IS NOT NULL;

CREATE TABLE chat_reactions (
  message_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- O que falta publicar: gravado na mesma transação da mensagem (quem publica relê daqui; cair no meio não perde nada).
CREATE TABLE chat_outbox (
  id BIGSERIAL PRIMARY KEY,
  routing_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  via TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX chat_outbox_pending_idx ON chat_outbox (id) WHERE published_at IS NULL;

CREATE TABLE chat_summaries (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  from_id BIGINT,
  since TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'gerando', 'pronto', 'erro')),
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check CHECK (entity_type IN ('task', 'comment', 'review', 'content_request', 'chat'));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'reacao', 'agendamento', 'rotina', 'financeiro', 'plateia', 'convite', 'lembrete', 'cadencia', 'episodio', 'alteracao', 'exclusao', 'integracao', 'mensagem'));
