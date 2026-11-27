-- Google Agenda por tipo de evento (gravações, tarefas, contas…): a tabela passa a ser indexada pela chave do evento do
-- calendário do painel (ex.: "gravacao-12"). A versão anterior só tinha gravações e ainda estava vazia.
DROP TABLE IF EXISTS gcal_events;
CREATE TABLE gcal_events (
  key       TEXT PRIMARY KEY,           -- chave do evento no calendário do painel (tipo-id)
  type      TEXT NOT NULL,
  day       DATE NOT NULL,              -- dia do evento (a rotina só remove o que ainda não passou)
  event_id  TEXT NOT NULL,
  hash      TEXT NOT NULL,
  html_link TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
