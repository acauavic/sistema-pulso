-- Redes por projeto: cada projeto tem as contas dele no provedor, os números dele e a configuração das respostas por IA.
-- O que existe é do Pulso. Publicação, corte e comentário continuam herdando o projeto pela raiz (sem coluna nova).

-- Estado de cada conta (ok, reconectar, sumiu) por projeto.
ALTER TABLE social_account_status ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1 REFERENCES projects(id);
ALTER TABLE social_account_status DROP CONSTRAINT social_account_status_pkey;
ALTER TABLE social_account_status ADD PRIMARY KEY (project_id, provider, network);

-- Números das redes: uma foto por dia, por rede e por projeto.
ALTER TABLE social_snapshots ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1 REFERENCES projects(id);
ALTER TABLE social_snapshots DROP CONSTRAINT social_snapshots_pkey;
ALTER TABLE social_snapshots ADD PRIMARY KEY (project_id, taken_on, platform);

-- Contexto que a IA usa nas respostas aos comentários e nos directs (quem é o projeto, em uma linha).
-- O nome vem de `public_name`; isto é o complemento entre parênteses.
ALTER TABLE projects ADD COLUMN ai_context TEXT;
UPDATE projects SET ai_context = 'podcast de saúde, inovação, empreendedorismo e negócios' WHERE id = 1;

-- O Projeto 100 passa a usar o Financeiro: o dinheiro já tem dono por projeto (fase 5), e a especificação já o listava
-- entre os módulos dele (produção, pauta, cortes, tarefas e financeiro).
UPDATE projects SET modules = modules || '{"financeiro": true}'::jsonb WHERE id = 2;
