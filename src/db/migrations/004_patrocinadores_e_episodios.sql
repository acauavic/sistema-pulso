-- Central de patrocinadores: CRM, formulário de cadastro (briefing), arquivos no Backblaze, entregáveis e episódios.
CREATE TABLE episodes (                      -- cadastro mínimo de episódios (os patrocínios apontam para eles)
  id         SERIAL PRIMARY KEY,
  number     INTEGER UNIQUE,                 -- EP.014
  title      TEXT NOT NULL,
  aired_on   DATE,                           -- data de veiculação (prevista ou real)
  status     TEXT NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','agendado','publicado')),
  guest_id   INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episodes_aired_idx ON episodes (aired_on);

CREATE TABLE sponsors (
  id                   SERIAL PRIMARY KEY,
  company              TEXT NOT NULL,
  website              TEXT,
  kind                 TEXT CHECK (kind IN ('marca_pessoal','negocio')),
  tier                 TEXT CHECK (tier IN ('ouro','diamond')),
  value_cents          BIGINT CHECK (value_cents >= 0),
  contact_name         TEXT,                  -- responsável pelo patrocínio NA EMPRESA
  contact_email        TEXT,
  contact_phone        TEXT,
  stage                TEXT NOT NULL DEFAULT 'prospect'
                       CHECK (stage IN ('prospect','negociacao','ganho','ativo','inativo','perdido')),
  owner_id             UUID REFERENCES users(id) ON DELETE SET NULL,   -- quem cuida do patrocinador na nossa equipe
  paid_at              DATE,                  -- pagamento confirmado (exigido para ficar ativo)
  starts_on            DATE,
  ends_on              DATE,
  notes                TEXT,
  public_token         TEXT UNIQUE,           -- links públicos: media kit, formulário e portal (/patrocinador/:token/…)
  token_generated_at   TIMESTAMPTZ,
  kit_viewed_at        TIMESTAMPTZ,
  brief_completed_at   TIMESTAMPTZ,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsors_stage_idx ON sponsors (stage);

CREATE TABLE sponsor_briefs (                -- respostas do formulário (a equipe também pode editar)
  sponsor_id   INTEGER PRIMARY KEY REFERENCES sponsors(id) ON DELETE CASCADE,
  landing_url  TEXT,                          -- página para divulgarmos
  landing_perk TEXT,                          -- brinde/benefício dessa página
  offer        TEXT,                          -- oferta ou ação especial para quem vier pelo podcast
  presentation TEXT,                          -- como apresentar a empresa
  key_points   TEXT,                          -- principais pontos a destacar
  restrictions TEXT,                          -- restrições de comunicação
  slogan       TEXT,
  goal         TEXT CHECK (goal IN ('reconhecimento','autoridade','leads','vendas','outro')),
  goal_other   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sponsor_files (                 -- arquivos guardados no Backblaze (bucket privado)
  id            SERIAL PRIMARY KEY,
  sponsor_id    INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('logo','audio','moldura','qrcode','material')),
  field         TEXT,                         -- áudio: a qual pergunta pertence
  storage_key   TEXT NOT NULL,
  filename      TEXT,
  content_type  TEXT,
  size_bytes    INTEGER,
  transcript    TEXT,                         -- transcrição original (Whisper); o texto final fica em sponsor_briefs
  from_sponsor  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_files_sponsor_idx ON sponsor_files (sponsor_id, kind);

CREATE TABLE sponsor_episodes (              -- episódios que o patrocínio contempla
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'insercao' CHECK (role IN ('exclusivo','insercao')),
  PRIMARY KEY (sponsor_id, episode_id)
);

CREATE TABLE sponsor_deliverables (
  id         SERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('episodio_exclusivo','insercao','corte_exclusivo','corte_participacao','moldura','qr_code','presenca_plataformas')),
  quantity   INTEGER CHECK (quantity > 0),
  status     TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_producao','ativo','concluido')),
  link_url   TEXT,                            -- QR Code: destino; demais: link da entrega
  file_id    INTEGER REFERENCES sponsor_files(id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_deliverables_sponsor_idx ON sponsor_deliverables (sponsor_id);

CREATE TABLE sponsor_events (                -- linha do tempo
  id         SERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_events_idx ON sponsor_events (sponsor_id, created_at DESC);

CREATE TABLE sponsor_clicks (                -- cliques humanos nos botões do media kit
  id         BIGSERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('quero','equipe')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_clicks_idx ON sponsor_clicks (sponsor_id, kind);
