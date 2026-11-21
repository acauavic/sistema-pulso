-- Convite do convidado: formato da gravação (mesa = sem plateia, plateia = com plateia) e o texto "Por que você",
-- escrito pela equipe (com ajuda da IA) e mostrado no topo do convite. O "motivo do convite" (invite_reason) continua interno.
ALTER TABLE guests ADD COLUMN IF NOT EXISTS invite_format TEXT NOT NULL DEFAULT 'mesa' CHECK (invite_format IN ('mesa', 'plateia'));
ALTER TABLE guests ADD COLUMN IF NOT EXISTS invite_why TEXT;
