-- Galeria "Quem já sentou à mesa" do media kit: a equipe escolhe quais episódios publicados aparecem.
ALTER TABLE episodes ADD COLUMN kit_featured   BOOLEAN NOT NULL DEFAULT false;   -- aparece na galeria do media kit
ALTER TABLE episodes ADD COLUMN kit_audience   TEXT;                              -- alcance do convidado, texto livre (ex.: +3,6M)
ALTER TABLE episodes ADD COLUMN kit_credential TEXT;                              -- frase curta de apresentação (em branco, usa o cadastro do convidado)
