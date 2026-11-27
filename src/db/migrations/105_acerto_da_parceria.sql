-- Acerto da parceria (Projeto 100): todo custo do projeto é guardado; quando entra dinheiro, o custo volta primeiro (para quem
-- pagou: a casa ou o parceiro, na proporção do que cada um gastou) e o que sobra é lucro, dividido quando a casa decide.
CREATE TABLE partnerships (
  project_id     INTEGER PRIMARY KEY REFERENCES projects(id),
  partner_name   TEXT NOT NULL,                              -- "Dr. José Bento"
  partner_people TEXT[] NOT NULL DEFAULT '{}',               -- quem paga do bolso do lado do parceiro (Dr. José Bento, Pedro)
  house_pct      NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (house_pct >= 0 AND house_pct <= 100),
  start_on       DATE NOT NULL,                              -- desde quando os custos contam
  active         BOOLEAN NOT NULL DEFAULT true,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Em que conta o dinheiro saiu ou entrou: a da casa (padrão) ou a do parceiro (gasto do bolso, receita que caiu do lado dele).
-- O que é do parceiro não entra no caixa da casa; entra no resultado do projeto e no acerto.
ALTER TABLE fin_entries ADD COLUMN account TEXT NOT NULL DEFAULT 'casa' CHECK (account IN ('casa', 'parceiro'));
ALTER TABLE fin_entries ADD COLUMN account_person TEXT;
ALTER TABLE fin_entries DROP CONSTRAINT IF EXISTS fin_entries_source_check;
ALTER TABLE fin_entries ADD CONSTRAINT fin_entries_source_check CHECK (source IN ('manual', 'regra', 'estudio', 'mensal', 'patrocinio', 'estoque', 'plateia', 'acerto'));
-- o mensal também guarda quem paga (o pró-labore é sempre da casa; um custo fixo do parceiro, dele)
ALTER TABLE fin_recurring ADD COLUMN account TEXT NOT NULL DEFAULT 'casa' CHECK (account IN ('casa', 'parceiro'));
ALTER TABLE fin_recurring ADD COLUMN account_person TEXT;

-- Cada acerto: o lucro que a casa decidiu distribuir naquele dia e a transferência que zera as contas
-- (`transfer_cents` > 0: a casa paga ao parceiro; < 0: o parceiro repassa à casa). A conta gerada é da categoria "acerto".
CREATE TABLE partnership_settlements (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  settled_on     DATE NOT NULL,
  profit_cents   BIGINT NOT NULL DEFAULT 0 CHECK (profit_cents >= 0),
  transfer_cents BIGINT NOT NULL DEFAULT 0,
  entry_id       INTEGER REFERENCES fin_entries(id) ON DELETE SET NULL,
  note           TEXT,
  snapshot       JSONB NOT NULL DEFAULT '{}',
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mês fechado: o extrato daquele mês fica gravado e o que foi pago nele não muda mais.
CREATE TABLE partnership_closings (
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  month          TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  statement      JSONB NOT NULL,
  closed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_at    TIMESTAMPTZ,
  reopened_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason  TEXT,
  PRIMARY KEY (project_id, month)
);

-- O extrato para o parceiro ver sem entrar (só leitura).
CREATE TABLE partnership_links (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  token       TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- O acordo do Projeto 100 (dito pelo dono em 2026-11-21): custo volta primeiro, depois 50/50. Começo e nomes editáveis na tela.
INSERT INTO partnerships (project_id, partner_name, partner_people, house_pct, start_on)
SELECT id, 'Dr. José Bento', ARRAY['Dr. José Bento', 'Pedro'], 50, DATE '2026-11-01' FROM projects WHERE slug = 'projeto-100'
ON CONFLICT DO NOTHING;
