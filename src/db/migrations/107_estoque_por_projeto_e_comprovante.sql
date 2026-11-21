-- Estoque por projeto: cada item é de um projeto, ou compartilhado (NULL: coisas do estúdio que os dois usam).
-- O que já existia era do Pulso (canecas, kits do convidado): vai para o projeto padrão.
ALTER TABLE fin_stock_items ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
UPDATE fin_stock_items SET project_id = (SELECT id FROM projects ORDER BY position, id LIMIT 1) WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS fin_stock_items_project_idx ON fin_stock_items (project_id);

-- Comprovante nos lançamentos: os anexos de sempre, ligados ao lançamento. purpose diz se é da conta (nota, boleto) ou do pagamento.
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check CHECK (entity_type IN ('task', 'comment', 'review', 'content_request', 'chat', 'fin_entry'));
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS purpose TEXT CHECK (purpose IN ('conta', 'pagamento'));
