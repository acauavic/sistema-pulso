-- A transcrição agora sai logo depois do envio do vídeo editado; o que diz "este vídeo já foi analisado pela IA" passa a ser a
-- análise em si (qual arquivo ela leu), e não a existência da transcrição.
ALTER TABLE episode_metadata ADD COLUMN ai_file_id INTEGER REFERENCES episode_files(id) ON DELETE SET NULL;
UPDATE episode_metadata m SET ai_file_id = t.source_file_id
  FROM episode_transcripts t WHERE t.episode_id = m.episode_id AND m.ai_generated_at IS NOT NULL;
