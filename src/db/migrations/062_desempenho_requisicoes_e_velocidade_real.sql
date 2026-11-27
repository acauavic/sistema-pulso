-- Requisições lentas do servidor (acima do limite, padrão 1 s) e velocidade real medida no navegador de quem usa o painel.
-- Gestão > Desempenho mostra os dois, junto com as consultas mais lentas do banco (pg_stat_statements).
CREATE TABLE slow_requests (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  method    TEXT NOT NULL,
  route     TEXT NOT NULL,          -- padrão da rota (/convidados/:id), para agrupar
  path      TEXT NOT NULL,          -- endereço de verdade (sem a busca)
  status    INTEGER NOT NULL,
  ms        INTEGER NOT NULL,       -- tempo total da resposta
  db_ms     INTEGER NOT NULL DEFAULT 0,
  db_count  INTEGER NOT NULL DEFAULT 0,
  user_id   UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX slow_requests_at_idx ON slow_requests (at DESC);

CREATE TABLE web_vitals (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  page    TEXT NOT NULL,            -- página agrupada (/episodios/:id)
  metric  TEXT NOT NULL CHECK (metric IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
  value   DOUBLE PRECISION NOT NULL, -- ms (CLS: sem unidade)
  device  TEXT NOT NULL CHECK (device IN ('celular', 'computador')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX web_vitals_at_idx ON web_vitals (at DESC);
