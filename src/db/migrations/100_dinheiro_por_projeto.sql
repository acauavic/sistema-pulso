-- Dinheiro por projeto: todo lançamento tem dono (um projeto) ou é compartilhado com divisão que soma o valor.
-- Nada muda de significado: o que existe hoje é do Pulso, e o pacote de horas entra com a cota inteira no Pulso.

-- vazio + divisão = compartilhado. O DEFAULT é rede de segurança (como nas raízes da fase 2): quem cria lançamento
-- informa o projeto, e quem compartilha grava NULL de propósito, junto com as linhas da divisão.
ALTER TABLE fin_entries ADD COLUMN project_id INTEGER DEFAULT 1 REFERENCES projects(id);
UPDATE fin_entries SET project_id = 1;
CREATE INDEX fin_entries_project_idx ON fin_entries (project_id);

-- Divisão do lançamento compartilhado: uma linha por projeto, somando o valor do lançamento.
CREATE TABLE fin_entry_splits (
  entry_id     INTEGER NOT NULL REFERENCES fin_entries(id) ON DELETE CASCADE,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (entry_id, project_id)
);
CREATE INDEX fin_entry_splits_project_idx ON fin_entry_splits (project_id);

-- Custo automático: em que projeto a regra vale (vazio = em todos). O lançamento que ela gera é do projeto do episódio
-- ou do convidado que a disparou.
ALTER TABLE fin_rules ADD COLUMN project_id INTEGER REFERENCES projects(id);
UPDATE fin_rules SET project_id = 1;  -- as regras de hoje são práticas do Pulso; a tela muda para "todos" quando for o caso

-- Custo mensal: não tem vínculo de onde herdar, então guarda o dono (ou a divisão padrão, em %) e repassa ao que gera.
ALTER TABLE fin_recurring
  ADD COLUMN project_id INTEGER REFERENCES projects(id),
  ADD COLUMN split      JSONB;  -- pesos da divisão ({"1": 25000, "2": 25000}); só com project_id vazio = compartilhado
UPDATE fin_recurring SET project_id = 1;

-- Cota de horas do banco por projeto: orçamento e aviso, não cobrança (a cobrança segue o uso).
CREATE TABLE fin_hour_quotas (
  pack_id    INTEGER NOT NULL REFERENCES fin_hour_packs(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  hours      NUMERIC(6,2) NOT NULL CHECK (hours >= 0),
  PRIMARY KEY (pack_id, project_id)
);
INSERT INTO fin_hour_quotas (pack_id, project_id, hours) SELECT id, 1, hours FROM fin_hour_packs;
