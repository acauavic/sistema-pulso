-- Banco de horas do estúdio: o Pulso compra um pacote de horas e as gravações a partir do episódio de início saem dele
-- (sem sinal, saldo ou hora extra por episódio). A migração não liga o banco nem lança compra: isso é feito pela tela.
ALTER TABLE fin_settings
  ADD COLUMN studio_mode TEXT NOT NULL DEFAULT 'hora' CHECK (studio_mode IN ('hora', 'banco')),
  ADD COLUMN studio_bank_start_episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  ADD COLUMN studio_bank_start_on DATE,            -- data do episódio de início, guardada ao ligar (vale se ele for apagado)
  ADD COLUMN studio_bank_alert_hours NUMERIC(5,2) NOT NULL DEFAULT 3 CHECK (studio_bank_alert_hours >= 0);

-- Compras de horas (cada uma vira uma despesa paga de estúdio).
CREATE TABLE fin_hour_packs (
  id           SERIAL PRIMARY KEY,
  bought_on    DATE NOT NULL,
  hours        NUMERIC(6,2) NOT NULL CHECK (hours > 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  note         TEXT,
  entry_id     INTEGER REFERENCES fin_entries(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
