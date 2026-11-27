-- Consumo da IA: uma linha por chamada ao Gemini (sucesso ou falha), com os tokens que o Google cobra.
-- O custo é calculado na tela (preço por milhão de tokens), para valer o preço atual também no histórico.
CREATE TABLE IF NOT EXISTS ai_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature TEXT NOT NULL DEFAULT 'outros',
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT true,
  status INTEGER,
  error TEXT,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at);
