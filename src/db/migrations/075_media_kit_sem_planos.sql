-- Media kit sem planos nem preços (leva para uma conversa): marcas que já patrocinaram aparecem como prova social (kit_show),
-- o convidado ganha o alcance no cadastro (agenda e galeria do kit) e o QR Code passa a ser apresentado pelo que entrega.
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS kit_show BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS reach TEXT;
UPDATE plan_items SET title = 'Leve a audiência direto para o seu site ou aplicativo',
       description = 'QR Code na tela, que aparece de forma espontânea pelo menos 5 vezes durante o episódio.'
 WHERE title = 'QR Code na tela';
