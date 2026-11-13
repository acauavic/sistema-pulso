-- Comentários da revisão do vídeo (na minutagem) também com texto rico, anexos e áudio.
ALTER TABLE episode_comments ADD COLUMN body_html TEXT;
ALTER TABLE attachments DROP CONSTRAINT attachments_entity_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check CHECK (entity_type IN ('task', 'comment', 'review'));
