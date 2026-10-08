-- O convite do Pulso flexiona o texto por gênero (convidado/convidada) e por dupla (?nomes=).
ALTER TABLE guests
  ADD COLUMN gender    TEXT NOT NULL DEFAULT 'm' CHECK (gender IN ('m','f')),
  ADD COLUMN is_plural BOOLEAN NOT NULL DEFAULT false;  -- convite para uma dupla: "name" guarda "Dr. João e Dra. Maria"
