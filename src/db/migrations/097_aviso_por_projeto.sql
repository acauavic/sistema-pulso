-- De que projeto é o aviso: quem não participa dele não vê o aviso na lista nem no contador.
-- Avisos antigos ficam sem projeto e continuam aparecendo para quem os recebeu (ninguém perde o que já tinha).
ALTER TABLE notifications ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX notifications_project_idx ON notifications (user_id, project_id);
