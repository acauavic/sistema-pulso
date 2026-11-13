-- Google Agenda: uma linha por convidado com gravação no calendário do Pulso Podcast.
-- Sem chave estrangeira de propósito: se o convidado for apagado, a linha fica para a rotina remover o evento do Google.
CREATE TABLE gcal_events (
  guest_id  INTEGER PRIMARY KEY,
  event_id  TEXT NOT NULL,
  hash      TEXT NOT NULL,
  html_link TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
