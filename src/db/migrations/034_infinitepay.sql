-- Links de pagamento da plateia (InfinitePay): um por tentativa. O pedido tem vários se a produtora mudar o valor;
-- o último aberto é o "link atual". A confirmação chega por webhook e é conferida na API antes de valer.
CREATE TABLE plateia_pay_links (
  id                SERIAL PRIMARY KEY,
  lead_id           INTEGER NOT NULL REFERENCES plateia_leads(id) ON DELETE CASCADE,
  order_nsu         TEXT NOT NULL UNIQUE,                -- identificador do pedido enviado à InfinitePay
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  url               TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'substituido')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ,
  transaction_nsu   TEXT UNIQUE,
  invoice_slug      TEXT,
  paid_amount_cents BIGINT,                              -- o que o cliente pagou (pode incluir taxa de parcelamento)
  capture_method    TEXT,                                -- pix | credit_card
  installments      INTEGER,
  receipt_url       TEXT
);
CREATE INDEX plateia_pay_links_lead_idx ON plateia_pay_links (lead_id, id DESC);
