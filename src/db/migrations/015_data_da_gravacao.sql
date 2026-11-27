-- A data da gravação fica no episódio (a veiculação é outra data). O episódio já nasce gravado:
-- rotinas de "virou Gravado" passam a ser de "episódio criado".
ALTER TABLE episodes ADD COLUMN recorded_on DATE;
UPDATE episodes e SET recorded_on = (g.proposed_at AT TIME ZONE 'America/Sao_Paulo')::date FROM guests g WHERE g.id = e.guest_id AND g.proposed_at IS NOT NULL;
UPDATE task_routines SET trigger = 'episodio_criado' WHERE trigger = 'etapa:gravado';
