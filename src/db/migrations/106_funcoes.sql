-- Funções sob medida: a gestão cria funções e escolhe o que cada uma acessa, por área; cada pessoa tem uma função padrão e
-- pode ter outra em cada projeto (editora no Pulso, gestora no Projeto 100).
--
-- `base` é o "trabalha como" (superadmin | gestao | produtora | editor_video): decide o Início, os avisos padrão e as tarefas do
-- calendário — é o que `users.role` guarda, e continua guardando. `perms` é o que a função acessa; nas quatro de fábrica fica
-- vazio (NULL = a matriz do código, permissions.js), até alguém editar.
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE,                                  -- só nas de fábrica (o nome do perfil de antes)
  name        TEXT NOT NULL,
  base        TEXT NOT NULL CHECK (base IN ('superadmin', 'gestao', 'produtora', 'editor_video')),
  perms       TEXT[],                                       -- NULL = a matriz do código (só nas de fábrica)
  builtin     BOOLEAN NOT NULL DEFAULT false,
  locked      BOOLEAN NOT NULL DEFAULT false,               -- superadmin: tudo, sempre
  position    INTEGER NOT NULL DEFAULT 100,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_perms_check CHECK (builtin OR perms IS NOT NULL)
);
CREATE UNIQUE INDEX roles_name_idx ON roles (lower(name));

INSERT INTO roles (key, name, base, builtin, locked, position) VALUES
  ('superadmin', 'Superadmin', 'superadmin', true, true, 1),
  ('gestao', 'Gestão', 'gestao', true, false, 2),
  ('produtora', 'Produtora', 'produtora', true, false, 3),
  ('editor_video', 'Editor de Vídeo', 'editor_video', true, false, 4);

ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);
UPDATE users u SET role_id = r.id FROM roles r WHERE r.key = u.role;
ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;
-- Quem grava só o perfil (o script do superadmin, código antigo) continua funcionando: sem função, vale a de fábrica do perfil;
-- trocar só o perfil leva a função de fábrica junto.
CREATE FUNCTION users_role_id_sync() RETURNS trigger AS $$
BEGIN
  IF NEW.role_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id) THEN
    NEW.role_id := (SELECT id FROM roles WHERE key = NEW.role);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER users_role_id_sync BEFORE INSERT OR UPDATE OF role, role_id ON users FOR EACH ROW EXECUTE FUNCTION users_role_id_sync();
ALTER TABLE users ADD COLUMN access_until DATE;               -- o acesso desliga sozinho depois deste dia (freelancer)

-- A função da pessoa naquele projeto (vazio = a padrão dela).
ALTER TABLE project_members ADD COLUMN role_id INTEGER REFERENCES roles(id);

-- O interruptor "Vê o financeiro" vira a área Financeiro da função: quem tinha o perfil que vê o dinheiro mas estava com o
-- interruptor desligado num projeto ganha, naquele projeto, uma cópia da função sem o financeiro. Ninguém ganha nem perde acesso.
INSERT INTO roles (name, base, perms, position)
SELECT 'Gestão sem financeiro', 'gestao',
       ARRAY['users.read','users.write','guests.read','guests.write','guests.invite','guests.delete','sponsors.read','sponsors.write','sponsors.delete',
             'pautas.read','pautas.write','episodes.read','episodes.write','episodes.delete','production.manage','production.upload','production.edit',
             'production.review','covers.edit','production.checklists','social.read','social.ideas','social.request','social.publish','social.comments',
             'social.automate','stock.read','stock.write','audience.read','audience.manage','calendar.read','calendar.share','tasks.read','tasks.write',
             'tasks.manage','comments.write','chat.use','notifications.manage','routines.manage','reminders.manage','plans.manage','search.manage',
             'contacts.manage','outreach.manage','goals.manage','projects.manage','catalog.manage','duplicates.manage','audit.read','trash.manage',
             'integrations.manage','roles.manage'], 50
 WHERE EXISTS (SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE NOT pm.finance AND u.role = 'gestao');
UPDATE project_members pm SET role_id = (SELECT id FROM roles WHERE name = 'Gestão sem financeiro')
  FROM users u WHERE u.id = pm.user_id AND NOT pm.finance AND u.role = 'gestao';
