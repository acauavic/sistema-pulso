-- O padrão do status do corte ficou "sugerido" (fluxo antigo); um corte novo nasce "enviando".
ALTER TABLE episode_clips ALTER COLUMN status SET DEFAULT 'enviando';
