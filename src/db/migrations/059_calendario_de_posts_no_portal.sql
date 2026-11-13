-- Portal do convidado: calendário de posts previstos (quantos, em que data e horário provável), sem precisar do post pronto.
ALTER TABLE guests ADD COLUMN portal_post_plan BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE guest_post_plan (
  id       SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  on_date  DATE NOT NULL,
  at_time  TIME,
  label    TEXT
);
CREATE INDEX guest_post_plan_guest_idx ON guest_post_plan (guest_id, on_date, at_time);
