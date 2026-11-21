-- Nome do projeto para quem está de fora. No painel o Pulso é "Pulso" (menu e seletor); no convite, no portal e nos
-- e-mails ele é "Podcast Pulso", como sempre foi. Sem nome público, vale o nome do projeto.
ALTER TABLE projects ADD COLUMN public_name TEXT;
UPDATE projects SET public_name = 'Podcast Pulso' WHERE id = 1;

-- O endereço público de cada projeto (`public_host`) continua vazio: quem liga é a gestão, pela tela de Projetos,
-- quando o DNS já aponta para o servidor. Vazio = tudo no endereço de hoje (é assim em desenvolvimento e no teste).
