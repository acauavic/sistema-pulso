-- Cortes de exemplo do convite: a equipe escolhe até 4 (com capa) em Gestão > Galeria do media kit. A data da escolha dá a ordem.
ALTER TABLE episode_clips ADD COLUMN IF NOT EXISTS invite_pick_at TIMESTAMPTZ;
