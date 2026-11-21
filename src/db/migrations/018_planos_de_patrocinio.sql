-- Planos de patrocínio (Ouro e Diamond) editáveis no painel de gestão: nome, preço, textos e entregáveis. O media kit, o portal do
-- patrocinador e a página do patrocinador leem daqui. Cada patrocinador herda os entregáveis do plano e pode personalizar
-- (renomear, mudar quantidade, descrever) ou ter entregáveis só dele.

CREATE TABLE sponsor_plans (
  key            TEXT PRIMARY KEY CHECK (key IN ('ouro', 'diamond')),
  position       INTEGER NOT NULL,
  name           TEXT NOT NULL,
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  episodes_label TEXT,                       -- linha "Episódios patrocinados" do comparativo
  tag            TEXT,                       -- chip do slide ("4 episódios patrocinados")
  headline       TEXT,
  lede           TEXT,
  includes       TEXT REFERENCES sponsor_plans(key) ON DELETE SET NULL,   -- Diamond inclui tudo do Ouro
  choice_label   TEXT,                       -- "Como a marca participa do episódio especial"
  note           TEXT,                       -- aviso no fim do slide
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_items (
  id          SERIAL PRIMARY KEY,
  plan_key    TEXT NOT NULL REFERENCES sponsor_plans(key) ON DELETE CASCADE,
  section     TEXT NOT NULL DEFAULT 'entrega' CHECK (section IN ('entrega', 'escolha')),   -- escolha = "escolha 1 de N"
  position    INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  description TEXT,
  kind        TEXT CHECK (kind IN ('episodio_exclusivo','insercao','corte_exclusivo','corte_participacao','moldura','qr_code','presenca_plataformas')),
  quantity    INTEGER CHECK (quantity > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_items_idx ON plan_items (plan_key, section, position);

-- entregáveis do patrocinador: herdam do plano (plan_item_id) e podem sobrescrever título, descrição e quantidade; ou são só dele
ALTER TABLE sponsor_deliverables DROP CONSTRAINT IF EXISTS sponsor_deliverables_kind_check;
ALTER TABLE sponsor_deliverables ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE sponsor_deliverables
  ADD COLUMN plan_item_id INTEGER REFERENCES plan_items(id) ON DELETE CASCADE,
  ADD COLUMN title        TEXT,
  ADD COLUMN description  TEXT;
ALTER TABLE sponsor_deliverables ADD CONSTRAINT sponsor_deliverables_kind_check
  CHECK (kind IS NULL OR kind IN ('episodio_exclusivo','insercao','corte_exclusivo','corte_participacao','moldura','qr_code','presenca_plataformas'));
ALTER TABLE sponsor_deliverables ADD CONSTRAINT sponsor_deliverables_has_name
  CHECK (kind IS NOT NULL OR title IS NOT NULL OR plan_item_id IS NOT NULL);
CREATE UNIQUE INDEX sponsor_deliverables_plan_uniq ON sponsor_deliverables (sponsor_id, plan_item_id) WHERE plan_item_id IS NOT NULL;

-- o que o media kit já dizia
INSERT INTO sponsor_plans (key, position, name, price_cents, episodes_label, tag, headline, lede, includes, choice_label, note) VALUES
  ('ouro', 0, 'Ouro', 600000, '4', '4 episódios patrocinados', 'Presença recorrente nos episódios.', 'Sua marca acompanha o Pulso ao longo de quatro episódios.', NULL, NULL, NULL),
  ('diamond', 1, 'Diamond', 1500000, '4 + episódio especial', 'Tudo do Ouro + episódio especial', 'A marca participa da conversa.', 'Um episódio inteiro co-criado com o patrocinador, além de tudo do Ouro.', 'ouro',
   'Como a marca participa do episódio especial', 'A pauta final é sempre alinhada com a equipe do Pulso, respeitando a audiência e a linha editorial do programa.');

INSERT INTO plan_items (plan_key, section, position, title, description, kind, quantity) VALUES
  ('ouro', 'entrega', 1, 'Inserção nos episódios', 'Apresentando o patrocinador, gravada nos episódios.', 'insercao', 4),
  ('ouro', 'entrega', 2, 'QR Code na tela', 'Direciona a audiência para o link da marca.', 'qr_code', NULL),
  ('ouro', 'entrega', 3, 'Moldura de patrocinador', 'Identidade visual do patrocinador em tela.', 'moldura', NULL),
  ('ouro', 'entrega', 4, 'Presença nas plataformas', 'Marca citada nas descrições no YouTube e Spotify.', 'presenca_plataformas', NULL),
  ('ouro', 'entrega', 5, 'Presença nos cortes', 'Presença em até 10 cortes no Instagram.', 'corte_participacao', 10),
  ('ouro', 'entrega', 6, 'Corte exclusivo', 'Um conteúdo dedicado só ao patrocinador.', 'corte_exclusivo', 1),
  ('diamond', 'entrega', 1, 'Episódio especial dedicado', 'Um episódio inteiro co-criado com a marca.', 'episodio_exclusivo', 1),
  ('diamond', 'entrega', 2, 'Ativações de marca no episódio especial', 'Produto em cena, material ao convidado, demonstração ou integração contextual, sempre alinhados com a equipe.', NULL, NULL),
  ('diamond', 'escolha', 1, 'Participar como convidado', 'Fundador ou executivo participa da conversa.', NULL, NULL),
  ('diamond', 'escolha', 2, 'Indicar um convidado', 'Você indica alguém relevante para o episódio.', NULL, NULL),
  ('diamond', 'escolha', 3, 'Sugerir uma pauta', 'Proponha um tema estratégico a desenvolver.', NULL, NULL),
  ('diamond', 'escolha', 4, 'Escolher episódio ou convidado', 'Com alinhamento editorial, você escolhe quem e quando.', NULL, NULL);

-- patrocinadores que já têm cota e ainda não têm nenhum entregável recebem os do plano (os cadastrados à mão ficam como estão)
INSERT INTO sponsor_deliverables (sponsor_id, kind, plan_item_id, status)
  SELECT s.id, pi.kind, pi.id, 'pendente'
    FROM sponsors s JOIN sponsor_plans p ON p.key = s.tier
    JOIN plan_items pi ON pi.section = 'entrega' AND (pi.plan_key = p.key OR pi.plan_key = p.includes)
   WHERE NOT EXISTS (SELECT 1 FROM sponsor_deliverables d WHERE d.sponsor_id = s.id);
UPDATE sponsor_deliverables d SET file_id = (SELECT f.id FROM sponsor_files f WHERE f.sponsor_id = d.sponsor_id AND f.kind = CASE d.kind WHEN 'moldura' THEN 'moldura' ELSE 'qrcode' END ORDER BY f.id DESC LIMIT 1)
 WHERE d.plan_item_id IS NOT NULL AND d.kind IN ('moldura', 'qr_code') AND d.file_id IS NULL;
