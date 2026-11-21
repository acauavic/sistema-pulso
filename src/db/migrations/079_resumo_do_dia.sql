-- Resumo do dia no Painel. Toda mudança de etapa do convidado vira uma linha (de → para, quando), venha de onde vier: quadro,
-- cadastro, edição em massa, aceite ou recusa pelo link, convite por e-mail, importação, episódio registrado. Um gatilho grava,
-- então nenhum caminho fica de fora. A linha sem "de" é o cadastro (a etapa em que o convidado nasceu).
CREATE TABLE IF NOT EXISTS guest_stage_log (
  id          BIGSERIAL PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_stage_log_at_idx ON guest_stage_log (changed_at);
CREATE INDEX IF NOT EXISTS guest_stage_log_guest_idx ON guest_stage_log (guest_id, changed_at);

CREATE OR REPLACE FUNCTION guests_stage_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO guest_stage_log (guest_id, from_status, to_status) VALUES (NEW.id, NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO guest_stage_log (guest_id, from_status, to_status) VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS guests_stage_log ON guests;
CREATE TRIGGER guests_stage_log AFTER INSERT OR UPDATE OF status ON guests FOR EACH ROW EXECUTE FUNCTION guests_stage_log();

-- O passado, refeito a partir da linha do tempo de cada convidado (guest_events):
-- 1) "Etapa: A → B" (quadro, cadastro, episódio registrado), "etapa A → B" (edição em massa, aceite zerado);
-- 2) as respostas pelo link: aceitou → Em agendamento, recusou → Perdido (o "de" é a etapa anterior conhecida);
-- 3) o convite por e-mail, que só muda a etapa de quem estava em Prospecção;
-- 4) o cadastro, na etapa de antes da primeira mudança (ou na atual, se nunca mudou);
-- 5) se a última mudança conhecida não bate com a etapa atual (um caminho que não deixou texto), a mudança entra no momento em
--    que o convidado entrou na etapa atual (stage_entered_at, mantido por gatilho em qualquer caminho).
-- Fica numa função para o teste conferir a leitura das mensagens.
CREATE OR REPLACE FUNCTION guest_stage_backfill() RETURNS integer AS $$
DECLARE added integer;
BEGIN
  WITH labels(label, key) AS (VALUES ('Prospecção', 'prospect'), ('Convite enviado', 'convite_enviado'), ('Em agendamento', 'em_agendamento'),
         ('Agendado', 'agendado'), ('Gravado', 'gravado'), ('Perdido', 'perdido'), ('Cancelado', 'cancelado')),
  raw AS (
    SELECT e.guest_id, e.created_at AS at, e.id AS ord, 'texto' AS kind, lf.key AS parsed_from, lt.key AS to_status
      FROM guest_events e
      CROSS JOIN LATERAL regexp_match(e.message, '[Ee]tapa:? ([^→;]+)→ ?([^(;]+)') AS m(parts)
      JOIN labels lf ON lf.label = btrim(m.parts[1])
      JOIN labels lt ON lt.label = btrim(m.parts[2])
     WHERE e.type = 'status'
    UNION ALL
    SELECT e.guest_id, e.created_at, e.id, 'resposta', NULL, CASE WHEN e.message LIKE 'Aceitou o convite%' THEN 'em_agendamento' ELSE 'perdido' END
      FROM guest_events e WHERE e.type = 'resposta' AND (e.message LIKE 'Aceitou o convite%' OR e.message LIKE 'Recusou o convite%')
    UNION ALL
    SELECT e.guest_id, e.created_at, e.id, 'email', 'prospect', 'convite_enviado' FROM guest_events e WHERE e.type = 'convite_enviado'
  ),
  chain AS (
    SELECT r.*, lag(r.to_status) OVER w AS prev_to, row_number() OVER w AS n
      FROM raw r WINDOW w AS (PARTITION BY r.guest_id ORDER BY r.at, r.ord)
  ),
  firsts AS (SELECT guest_id, coalesce(parsed_from, 'convite_enviado') AS initial FROM chain WHERE n = 1),
  moves AS (
    SELECT c.guest_id, c.at, c.kind, c.to_status,
           coalesce(CASE WHEN c.kind = 'texto' THEN c.parsed_from END, c.prev_to, f.initial) AS from_status
      FROM chain c JOIN firsts f USING (guest_id)
  ),
  ins AS (
    INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at)
    SELECT g.id, NULL, coalesce(f.initial, g.status), g.created_at FROM guests g LEFT JOIN firsts f ON f.guest_id = g.id
    UNION ALL
    SELECT m.guest_id, m.from_status, m.to_status, m.at FROM moves m JOIN guests g ON g.id = m.guest_id
     WHERE m.from_status IS DISTINCT FROM m.to_status AND NOT (m.kind = 'email' AND m.from_status <> 'prospect')
    RETURNING 1
  )
  SELECT count(*) INTO added FROM ins;

  INSERT INTO guest_stage_log (guest_id, from_status, to_status, changed_at)
  SELECT g.id, l.to_status, g.status, greatest(g.stage_entered_at, l.changed_at)
    FROM guests g
    JOIN LATERAL (SELECT to_status, changed_at FROM guest_stage_log WHERE guest_id = g.id ORDER BY changed_at DESC, id DESC LIMIT 1) l ON true
   WHERE l.to_status IS DISTINCT FROM g.status;
  RETURN added;
END $$ LANGUAGE plpgsql;

SELECT guest_stage_backfill() WHERE NOT EXISTS (SELECT 1 FROM guest_stage_log);
