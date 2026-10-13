-- Formulário do patrocinador, uma pergunta por vez: perguntas puladas viram pendência; algumas podem ser marcadas "não se aplica".
ALTER TABLE sponsor_briefs
  ADD COLUMN skipped TEXT[] NOT NULL DEFAULT '{}',   -- perguntas que ele escolheu responder depois (pendências)
  ADD COLUMN na      TEXT[] NOT NULL DEFAULT '{}',   -- perguntas marcadas como "não se aplica" (contam como respondidas)
  ADD COLUMN sent_at TIMESTAMPTZ;                    -- última vez que ele fechou o formulário (resumo)
