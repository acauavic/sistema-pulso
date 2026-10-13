-- Convidado e episódio separados: o convidado (pessoa) vai até Gravado; o episódio (produto) nasce em Gravado e segue até Publicado.
-- Antes da gravação existe a AGENDA (convidados em Agendado). O patrocinador reserva uma gravação marcada (sponsor_bookings);
-- ao gravar, a reserva vira vínculo do episódio (sponsor_episodes). O convidado pode ser do patrocinador ou indicado por ele.

-- convidado ligado a um patrocinador
ALTER TABLE guests
  ADD COLUMN sponsor_id       INTEGER REFERENCES sponsors(id) ON DELETE SET NULL,
  ADD COLUMN sponsor_relation TEXT CHECK (sponsor_relation IN ('representante', 'indicado'));
CREATE INDEX guests_sponsor_idx ON guests (sponsor_id) WHERE sponsor_id IS NOT NULL;

-- reservas: patrocinador x gravação marcada (convidado ainda sem episódio)
CREATE TABLE sponsor_bookings (
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'insercao' CHECK (role IN ('exclusivo', 'insercao')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sponsor_id, guest_id)
);

-- episódios criados antes da gravação (Planejado/Agendado) eram, na prática, reservas.
-- Com convidado: o vínculo com patrocinador vira reserva; tarefas de rotina saem (renascem na gravação); as manuais ficam no convidado.
INSERT INTO sponsor_bookings (sponsor_id, guest_id, role)
  SELECT se.sponsor_id, e.guest_id, se.role FROM sponsor_episodes se JOIN episodes e ON e.id = se.episode_id
   WHERE e.status IN ('planejado', 'agendado') AND e.guest_id IS NOT NULL
  ON CONFLICT DO NOTHING;
DELETE FROM tasks t USING episodes e WHERE t.episode_id = e.id AND e.status IN ('planejado', 'agendado') AND t.routine_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM episode_files f WHERE f.episode_id = e.id);
UPDATE tasks t SET guest_id = coalesce(t.guest_id, e.guest_id), episode_id = NULL FROM episodes e
 WHERE t.episode_id = e.id AND e.status IN ('planejado', 'agendado') AND NOT EXISTS (SELECT 1 FROM episode_files f WHERE f.episode_id = e.id);
DELETE FROM episodes e WHERE e.status IN ('planejado', 'agendado') AND NOT EXISTS (SELECT 1 FROM episode_files f WHERE f.episode_id = e.id);
-- os que já têm material foram gravados
UPDATE episodes SET status = 'gravado' WHERE status IN ('planejado', 'agendado');
ALTER TABLE episodes DROP CONSTRAINT episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check CHECK (status IN
  ('gravado','disponivel_edicao','em_edicao','em_revisao','em_finalizacao','pronto_publicar','publicado'));
ALTER TABLE episodes ALTER COLUMN status SET DEFAULT 'gravado';

-- o convidado termina em Gravado; os links de publicação são do episódio
UPDATE episodes e SET youtube_url = coalesce(e.youtube_url, g.youtube_url), spotify_url = coalesce(e.spotify_url, g.spotify_url)
  FROM guests g WHERE g.id = e.guest_id AND g.status = 'publicado';
UPDATE guests SET status = 'gravado' WHERE status = 'publicado';
ALTER TABLE guests DROP CONSTRAINT guests_status_check;
ALTER TABLE guests ADD CONSTRAINT guests_status_check
  CHECK (status IN ('prospect','convite_enviado','em_agendamento','agendado','gravado','recusou','cancelado'));
