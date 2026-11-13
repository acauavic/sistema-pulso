-- Lixeira: o que se apaga fica 15 dias guardado (o item e tudo o que o banco apagaria junto) e pode voltar como estava.
-- Os arquivos no armazenamento só são apagados quando o prazo vence (services/trash.js).
CREATE TABLE trash_items (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,                  -- episode, guest, sponsor, task, clip, cover, request, episode_file, sponsor_file, fin_entry
  ref_id       TEXT NOT NULL,                  -- id do item apagado (volta com o mesmo id)
  title        TEXT NOT NULL,
  context      TEXT,                           -- de onde era (ex.: EP.019 · Fulano)
  batch        UUID NOT NULL,                  -- mesma exclusão (ex.: 10 cortes de uma vez): "Desfazer" devolve o lote inteiro
  payload      JSONB NOT NULL,                 -- { rows, relinks, states }: linhas apagadas, ligações desfeitas e estados alterados
  storage_keys TEXT[] NOT NULL DEFAULT '{}',   -- arquivos no Backblaze que só saem na limpeza
  deleted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_after  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 days'
);
CREATE INDEX trash_items_purge_idx ON trash_items (purge_after);
CREATE INDEX trash_items_batch_idx ON trash_items (batch);
CREATE INDEX trash_items_by_idx ON trash_items (deleted_by, deleted_at DESC);
