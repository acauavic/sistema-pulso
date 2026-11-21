-- Terceiro provedor de publicação: Outstand (além de Upload-Post e Zernio).
ALTER TABLE episode_publications DROP CONSTRAINT IF EXISTS episode_publications_provider_check;
ALTER TABLE episode_publications ADD CONSTRAINT episode_publications_provider_check CHECK (provider IN ('uploadpost', 'zernio', 'outstand'));
