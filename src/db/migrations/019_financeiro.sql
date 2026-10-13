-- Financeiro: contas a pagar e a receber, custos automáticos por episódio, custos mensais, estúdio e estoque.
ALTER TABLE episodes ADD COLUMN recording_minutes INTEGER CHECK (recording_minutes > 0);   -- duração real da gravação (calcula o estúdio)

-- Ajustes gerais (uma linha só).
CREATE TABLE fin_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  studio_hour_cents    BIGINT NOT NULL DEFAULT 30000,   -- R$ 300 por hora de estúdio
  studio_deposit_cents BIGINT NOT NULL DEFAULT 15000,   -- R$ 150 de sinal para reservar a data
  studio_minutes       INTEGER NOT NULL DEFAULT 60,     -- duração esperada enquanto não se sabe a real
  episodes_per_month   NUMERIC(5,2) NOT NULL DEFAULT 4, -- cadência: base da previsão de estoque
  opening_balance_cents BIGINT NOT NULL DEFAULT 0,      -- caixa na data abaixo
  opening_on           DATE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fin_settings (id) VALUES (1);

-- Regras de custo automático: nascem sozinhas em um momento da vida do episódio.
CREATE TABLE fin_rules (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  trigger      TEXT NOT NULL CHECK (trigger IN ('gravacao_agendada', 'episodio_gravado', 'episodio_publicado')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  anchor       TEXT NOT NULL DEFAULT 'gatilho' CHECK (anchor IN ('gatilho', 'gravacao', 'veiculacao')),
  offset_days  INTEGER NOT NULL DEFAULT 0,
  supplier     TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Custos que se repetem todo mês (salário da produtora, assinaturas…).
CREATE TABLE fin_recurring (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  day_of_month INTEGER NOT NULL DEFAULT 5 CHECK (day_of_month BETWEEN 1 AND 28),
  starts_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on      DATE,
  supplier     TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Itens de estoque (canecas, caixas de presente, cartões de visita…).
CREATE TABLE fin_stock_items (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'un',
  per_episode     NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (per_episode >= 0),  -- quanto sai a cada episódio gravado
  min_qty         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),     -- alerta quando chegar neste saldo
  lead_days       INTEGER NOT NULL DEFAULT 15 CHECK (lead_days >= 0),        -- quanto leva para repor (produção + entrega + folga)
  unit_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),    -- custo médio por unidade
  supplier        TEXT,
  notes           TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lançamentos: tudo que se paga e se recebe.
CREATE TABLE fin_entries (
  id            SERIAL PRIMARY KEY,
  direction     TEXT NOT NULL CHECK (direction IN ('saida', 'entrada')),
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  BIGINT NOT NULL CHECK (amount_cents >= 0),
  due_on        DATE NOT NULL,
  paid_on       DATE,
  status        TEXT NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'pago', 'cancelado')),
  supplier      TEXT,
  notes         TEXT,
  episode_id    INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  guest_id      INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  sponsor_id    INTEGER REFERENCES sponsors(id) ON DELETE SET NULL,
  stock_item_id INTEGER REFERENCES fin_stock_items(id) ON DELETE SET NULL,
  rule_id       INTEGER REFERENCES fin_rules(id) ON DELETE SET NULL,
  recurring_id  INTEGER REFERENCES fin_recurring(id) ON DELETE SET NULL,
  installment_no INTEGER,
  installments  INTEGER,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'regra', 'estudio', 'mensal', 'patrocinio', 'estoque')),
  cancel_reason TEXT CHECK (cancel_reason IN ('sistema', 'usuario')), -- o sistema só reativa o que ele mesmo cancelou
  auto_key      TEXT UNIQUE,                     -- impede lançar duas vezes o mesmo custo automático
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'pago') = (paid_on IS NOT NULL))
);
CREATE INDEX fin_entries_due_idx ON fin_entries (due_on) WHERE status = 'previsto';
CREATE INDEX fin_entries_paid_idx ON fin_entries (paid_on) WHERE status = 'pago';
CREATE INDEX fin_entries_episode_idx ON fin_entries (episode_id);
CREATE INDEX fin_entries_guest_idx ON fin_entries (guest_id);
CREATE INDEX fin_entries_sponsor_idx ON fin_entries (sponsor_id);

CREATE TABLE fin_stock_moves (
  id              SERIAL PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES fin_stock_items(id) ON DELETE CASCADE,
  qty             NUMERIC(10,2) NOT NULL CHECK (qty <> 0),     -- + entrada, − saída
  reason          TEXT NOT NULL CHECK (reason IN ('compra', 'episodio', 'ajuste', 'perda', 'brinde')),
  episode_id      INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  entry_id        INTEGER REFERENCES fin_entries(id) ON DELETE SET NULL,
  unit_cost_cents BIGINT NOT NULL DEFAULT 0,
  note            TEXT,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fin_stock_moves_item_idx ON fin_stock_moves (item_id, created_at DESC);
CREATE UNIQUE INDEX fin_stock_moves_episode_uni ON fin_stock_moves (item_id, episode_id) WHERE reason = 'episodio';

-- Avisos do financeiro (vencimentos, estoque baixo).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro'));
ALTER TABLE notification_settings DROP CONSTRAINT IF EXISTS notification_settings_type_check;
ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_type_check CHECK (type IN ('tarefa', 'comentario', 'agendamento', 'rotina', 'financeiro'));
INSERT INTO notification_settings (type, roles) VALUES ('financeiro', '{superadmin,gestao}') ON CONFLICT DO NOTHING;
