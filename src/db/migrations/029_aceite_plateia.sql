-- Aceite das condições da plateia: guarda quando a pessoa aceitou e qual versão do texto ela viu.
ALTER TABLE plateia_leads ADD COLUMN terms_accepted_at TIMESTAMPTZ;
ALTER TABLE plateia_leads ADD COLUMN terms_version TEXT;
