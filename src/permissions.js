// Papéis e permissões. ÚNICO lugar a editar quando os poderes de cada role forem definidos.
// ATENÇÃO: a matriz abaixo é PROVISÓRIA (rascunho até o dono do podcast descrever os poderes).

const ROLES = {
  superadmin: { label: 'Superadmin', rank: 4 },
  gestao: { label: 'Gestão', rank: 3 },
  produtora: { label: 'Produtora', rank: 2 },
  editor_video: { label: 'Editor de Vídeo', rank: 1 },
};

const ALL = Object.keys(ROLES);

// permissão -> roles que a possuem
const PERMISSIONS = {
  'users.read': ['superadmin', 'gestao'],
  'users.write': ['superadmin', 'gestao'], // gestão não mexe em superadmin (ver canManageUser)
  'users.delete': ['superadmin'],
  'guests.read': ALL,
  'guests.write': ['superadmin', 'gestao', 'produtora'],
  'guests.invite': ['superadmin', 'gestao', 'produtora'], // gerar link e enviar e-mail
  'guests.delete': ['superadmin', 'gestao'],
  'templates.read': ['superadmin', 'gestao', 'produtora'],
  'templates.write': ['superadmin', 'gestao'],
  'audit.read': ['superadmin', 'gestao'],
  'integrations.manage': ['superadmin', 'gestao'], // ver status e testar Brevo/YOURLS
};

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  return Boolean(allowed && allowed.includes(role));
}

// Quem pode criar/editar/desativar/excluir o usuário `target`?
// Regra: superadmin só é tocado por superadmin.
function canManageUser(actorRole, targetRole) {
  if (!can(actorRole, 'users.write')) return false;
  if (targetRole === 'superadmin' || targetRole == null) return actorRole === 'superadmin';
  return true;
}

// Roles que o ator pode atribuir.
function assignableRoles(actorRole) {
  if (!can(actorRole, 'users.write')) return [];
  return Object.keys(ROLES).filter((r) => r !== 'superadmin' || actorRole === 'superadmin');
}

const isRole = (value) => Object.prototype.hasOwnProperty.call(ROLES, value);

module.exports = { ROLES, PERMISSIONS, can, canManageUser, assignableRoles, isRole };
