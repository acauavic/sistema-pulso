-- Confirmar a participação na plateia: valor combinado e a conta a receber correspondente.
ALTER TABLE plateia_leads ADD COLUMN amount_cents BIGINT CHECK (amount_cents >= 0);       -- valor combinado com a pessoa
ALTER TABLE plateia_leads ADD COLUMN confirmed_at TIMESTAMPTZ;
ALTER TABLE plateia_leads ADD COLUMN entry_id INTEGER REFERENCES fin_entries(id) ON DELETE SET NULL;
ALTER TABLE fin_entries DROP CONSTRAINT IF EXISTS fin_entries_source_check;
ALTER TABLE fin_entries ADD CONSTRAINT fin_entries_source_check CHECK (source IN ('manual', 'regra', 'estudio', 'mensal', 'patrocinio', 'estoque', 'plateia'));
