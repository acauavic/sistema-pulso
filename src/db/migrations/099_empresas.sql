-- Empresa e contrato: o cadastro da empresa é da casa, a negociação é de um projeto.
-- A linha de `sponsors` continua sendo o contrato (etapa, plano, valor, vigência, entregáveis, portal, material) e aponta
-- para a empresa. As colunas de identidade ficam onde estão, como cópia espelhada (services/companies.js grava nos dois
-- lados), como em `people`/`guests`. Quem patrocina os dois projetos tem dois contratos e um cadastro só.

CREATE TABLE companies (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  website       TEXT,
  kind          TEXT,                  -- tipo da marca, como em sponsors.kind
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opcional de propósito, igual a guests.person_id: é o serviço que liga, em qualquer caminho que escreva identidade.
ALTER TABLE sponsors ADD COLUMN company_id INTEGER REFERENCES companies(id);

INSERT INTO companies (id, name, website, kind, contact_name, contact_email, contact_phone, created_at, updated_at)
SELECT s.id, s.company, s.website, s.kind, s.contact_name, s.contact_email, s.contact_phone, s.created_at, s.updated_at
  FROM sponsors s;
SELECT setval(pg_get_serial_sequence('companies', 'id'), greatest((SELECT coalesce(max(id), 0) FROM companies), 1));

UPDATE sponsors SET company_id = id;
CREATE INDEX sponsors_company_idx ON sponsors (company_id);
