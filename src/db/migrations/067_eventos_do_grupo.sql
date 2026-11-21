-- Mensagens: o que acontece no grupo (criou, entrou, saiu, mudou o nome) aparece na própria conversa, como uma linha discreta.
-- event = tipo do acontecimento; body = a frase pronta ("Ana criou o grupo"). Mensagem normal tem event nulo.
ALTER TABLE chat_messages ADD COLUMN event TEXT CHECK (event IN ('criou', 'adicionou', 'removeu', 'saiu', 'renomeou'));
