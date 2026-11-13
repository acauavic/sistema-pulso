-- Plateia: pessoas adicionadas à mão pelo painel e tarefa única de lembrete no dia da gravação.
ALTER TABLE plateia_leads ADD COLUMN added_by UUID REFERENCES users(id) ON DELETE SET NULL;   -- preenchido = adicionada pela equipe (não veio da página pública)
ALTER TABLE tasks ADD COLUMN auto_key TEXT;                                                   -- tarefas criadas pelo sistema que não podem repetir
CREATE UNIQUE INDEX tasks_auto_key_idx ON tasks (auto_key) WHERE auto_key IS NOT NULL;
