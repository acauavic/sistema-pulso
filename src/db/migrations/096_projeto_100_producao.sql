-- O Projeto 100 passa a trabalhar dentro do sistema: vídeos (com pauta e roteiro), convidados e o conteúdo que sai deles.
-- Fica de fora por enquanto: convites, portal, plateia, media kit, redes e financeiro — cada um entra na sua fase.
UPDATE projects SET modules = modules || '{"producao": true, "convidados": true}'::jsonb, updated_at = now() WHERE slug = 'projeto-100';
