-- Convite de calendário por e-mail ao convidado (arquivo .ics: Gmail, Outlook e Apple Calendário mostram "Adicionar").
-- Uma linha por convidado com o último convite enviado; sem chave estrangeira para ainda poder enviar o cancelamento
-- se o convidado for apagado.
CREATE TABLE guest_cal_invites (
  guest_id   INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  start_at   TIMESTAMPTZ NOT NULL,
  minutes    INTEGER NOT NULL,
  sequence   INTEGER NOT NULL DEFAULT 0,   -- aumenta a cada remarcação (o calendário do convidado entende que é o mesmo evento)
  hash       TEXT NOT NULL,
  sent_at    TIMESTAMPTZ,                  -- NULL = só registrado (ao ligar o recurso, quem já estava agendado não recebe e-mail)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
