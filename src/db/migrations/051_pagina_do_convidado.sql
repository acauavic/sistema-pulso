-- Plateia: página própria de cada convidado (/plateia/com/:slug) e links de parceiro com participação isenta.
ALTER TABLE guests ADD COLUMN audience_page_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guests ADD COLUMN audience_slug TEXT;
ALTER TABLE guests ADD COLUMN audience_intro TEXT;            -- como será a gravação (texto curto)
ALTER TABLE guests ADD COLUMN audience_arrival TIME;          -- horário de chegada da plateia (diferente do início da gravação)
ALTER TABLE guests ADD COLUMN audience_extra_title TEXT;      -- bloco extra: só aparece se preenchido
ALTER TABLE guests ADD COLUMN audience_extra TEXT;
CREATE UNIQUE INDEX guests_audience_slug_idx ON guests (audience_slug) WHERE audience_slug IS NOT NULL;

CREATE TABLE guest_audience_photos (
  id          SERIAL PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guest_audience_photos_guest_idx ON guest_audience_photos (guest_id, position, id);

-- Link de parceiro: quem entra por ele pede participação sem cobrança, até o limite de vagas (null = sem limite).
CREATE TABLE plateia_partners (
  id          SERIAL PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  slots       INTEGER CHECK (slots IS NULL OR slots > 0),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plateia_partners_guest_idx ON plateia_partners (guest_id);

ALTER TABLE plateia_leads ADD COLUMN partner_id INTEGER REFERENCES plateia_partners(id) ON DELETE SET NULL;
ALTER TABLE plateia_leads ADD COLUMN partner_name TEXT;        -- fica no pedido mesmo se o link for apagado
