-- Resumo do dia, patrocínio. Toda mudança de etapa do patrocinador vira uma linha (de → para, quando), venha de onde vier:
-- quadro, cadastro, painel do patrocínio, "Agendar uma conversa" no media kit, episódio registrado, juntar duplicatas. Um gatilho
-- grava, então nenhum caminho fica de fora. A linha sem "de" é o cadastro (a etapa em que o patrocinador nasceu). O mesmo desenho
-- de guest_stage_log (079).
CREATE TABLE IF NOT EXISTS sponsor_stage_log (
  id         BIGSERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsor_stage_log_at_idx ON sponsor_stage_log (changed_at);
CREATE INDEX IF NOT EXISTS sponsor_stage_log_sponsor_idx ON sponsor_stage_log (sponsor_id, changed_at);

CREATE OR REPLACE FUNCTION sponsors_stage_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage) VALUES (NEW.id, NULL, NEW.stage);
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage) VALUES (NEW.id, OLD.stage, NEW.stage);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sponsors_stage_log ON sponsors;
CREATE TRIGGER sponsors_stage_log AFTER INSERT OR UPDATE OF stage ON sponsors FOR EACH ROW EXECUTE FUNCTION sponsors_stage_log();

-- O passado, refeito a partir da linha do tempo de cada patrocinador (sponsor_events):
-- 1) "Etapa: A → B" (quadro, cadastro, painel do patrocínio) e "…: Prospecção → Em negociação" (pediu uma conversa pelo media kit);
-- 2) o cadastro, na etapa de antes da primeira mudança (ou na atual, se nunca mudou);
-- 3) se a última mudança conhecida não bate com a etapa atual (um caminho que não deixou texto), a mudança entra no momento em
--    que o patrocinador entrou na etapa atual (stage_entered_at, mantido por gatilho em qualquer caminho).
-- Fica numa função para o teste conferir a leitura das mensagens.
CREATE OR REPLACE FUNCTION sponsor_stage_backfill() RETURNS integer AS $$
DECLARE added integer;
BEGIN
  WITH labels(label, key) AS (VALUES ('Prospecção', 'prospect'), ('Em negociação', 'negociacao'), ('Ganho', 'ganho'),
         ('Ativo', 'ativo'), ('Inativo', 'inativo'), ('Perdido', 'perdido')),
  raw AS (
    SELECT e.sponsor_id, e.created_at AS at, e.id AS ord, lf.key AS from_stage, lt.key AS to_stage
      FROM sponsor_events e
      CROSS JOIN LATERAL regexp_match(e.message, ':([^:→]+)→([^→]+)$') AS m(parts)
      JOIN labels lf ON lf.label = btrim(m.parts[1])
      JOIN labels lt ON lt.label = btrim(m.parts[2])
     WHERE e.type = 'etapa'
  ),
  chain AS (SELECT r.*, row_number() OVER (PARTITION BY r.sponsor_id ORDER BY r.at, r.ord) AS n FROM raw r),
  ins AS (
    INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage, changed_at)
    SELECT s.id, NULL, coalesce(c.from_stage, s.stage), s.created_at FROM sponsors s LEFT JOIN chain c ON c.sponsor_id = s.id AND c.n = 1
    UNION ALL
    SELECT c.sponsor_id, c.from_stage, c.to_stage, c.at FROM chain c JOIN sponsors s ON s.id = c.sponsor_id
     WHERE c.from_stage IS DISTINCT FROM c.to_stage
    RETURNING 1
  )
  SELECT count(*) INTO added FROM ins;

  INSERT INTO sponsor_stage_log (sponsor_id, from_stage, to_stage, changed_at)
  SELECT s.id, l.to_stage, s.stage, greatest(s.stage_entered_at, l.changed_at)
    FROM sponsors s
    JOIN LATERAL (SELECT to_stage, changed_at FROM sponsor_stage_log WHERE sponsor_id = s.id ORDER BY changed_at DESC, id DESC LIMIT 1) l ON true
   WHERE l.to_stage IS DISTINCT FROM s.stage;
  RETURN added;
END $$ LANGUAGE plpgsql;

SELECT sponsor_stage_backfill() WHERE NOT EXISTS (SELECT 1 FROM sponsor_stage_log);
