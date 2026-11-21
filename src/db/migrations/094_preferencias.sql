-- Preferências de tela de cada pessoa (o que ela escolheu da última vez e o sistema devolve igual na próxima).
-- Guardadas no servidor, e não no navegador, para a escolha valer no computador e no celular. Chaves em uso: "tarefas_visao".
ALTER TABLE users ADD COLUMN prefs JSONB NOT NULL DEFAULT '{}';
