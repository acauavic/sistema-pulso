-- Por qual provedor cada publicação saiu (Upload-Post ou Zernio). As antigas foram todas pelo Upload-Post.
ALTER TABLE episode_publications ADD COLUMN provider TEXT NOT NULL DEFAULT 'uploadpost' CHECK (provider IN ('uploadpost', 'zernio'));
