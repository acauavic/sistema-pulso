-- Novidades: guarda a última versão (src/releases.js) que a pessoa já viu, para avisar uma vez a cada atualização.
ALTER TABLE users ADD COLUMN release_seen TEXT;
