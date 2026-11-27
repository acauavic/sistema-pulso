-- Mensagens: @menções (quem foi marcado; @todos marca o grupo inteiro) e a escolha de avisos de cada pessoa.
ALTER TABLE chat_messages ADD COLUMN mentions UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE chat_messages ADD COLUMN mention_all BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX chat_messages_mentions_idx ON chat_messages USING gin (mentions);
-- Avisos desta conversa: nulo = segue a preferência da pessoa; tudo | mencoes (só quando me marcam) | nada.
ALTER TABLE chat_members ADD COLUMN notify TEXT CHECK (notify IN ('tudo', 'mencoes', 'nada'));
-- Preferência da pessoa para GRUPOS: tudo | mencoes. Conversa individual sempre avisa (a não ser que a conversa esteja em "nada").
ALTER TABLE users ADD COLUMN chat_notify TEXT NOT NULL DEFAULT 'tudo' CHECK (chat_notify IN ('tudo', 'mencoes'));
