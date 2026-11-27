-- Chamada do fim do texto, por rede (no YouTube, se inscrever; no Instagram, seguir o perfil...), escrita pela IA para cada corte.
-- A legenda fica sem a chamada; cada rede recebe a sua no envio (episode_publications.options.ctas).
ALTER TABLE episode_clips ADD COLUMN IF NOT EXISTS ctas JSONB;
