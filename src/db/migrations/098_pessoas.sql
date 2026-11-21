-- Pessoa e participação: o cadastro da pessoa é da casa, o funil é de um projeto.
-- A linha de `guests` continua sendo a participação (etapa, tema, convite, portal, plateia) e aponta para a pessoa.
-- As colunas de identidade ficam onde estão, como cópia espelhada (services/people.js grava nos dois lados), para as
-- consultas que leem guests.name seguirem funcionando (docs/superpowers/specs/2026-11-20-multiprojetos-design.md).

CREATE TABLE people (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  instagram  TEXT,
  company    TEXT,
  job_title  TEXT,
  bio        TEXT,
  gender     TEXT NOT NULL DEFAULT 'm',
  is_plural  BOOLEAN NOT NULL DEFAULT false,
  photo_key  TEXT,
  reach      TEXT,            -- como em guests: o dono escreve "120 mil" quando quer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fica aceito sem pessoa de propósito: é o serviço (services/people.js) que liga, e ele liga na hora em qualquer
-- caminho que escreva identidade. Assim nenhuma criação de convidado precisa saber da pessoa para funcionar, e uma
-- participação que chegue solta (restaurada da lixeira, importada) se conserta sozinha na primeira escrita.
ALTER TABLE guests ADD COLUMN person_id INTEGER REFERENCES people(id);

-- Cada convidado de hoje vira uma pessoa com o mesmo id: o espelho se confere a olho e a ligação não depende de mapa.
INSERT INTO people (id, name, email, phone, instagram, company, job_title, bio, gender, is_plural, photo_key, reach, created_at, updated_at)
SELECT g.id, g.name, g.email, g.phone, g.instagram, g.company, g.job_title, g.bio, coalesce(g.gender, 'm'),
       coalesce(g.is_plural, false), g.photo_key, g.reach, g.created_at, g.updated_at
  FROM guests g;
SELECT setval(pg_get_serial_sequence('people', 'id'), greatest((SELECT coalesce(max(id), 0) FROM people), 1));

UPDATE guests SET person_id = id;
CREATE INDEX guests_person_idx ON guests (person_id);
