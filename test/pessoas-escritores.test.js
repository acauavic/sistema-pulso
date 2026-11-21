// Todo caminho que escreve identidade do convidado passa pelo espelho: depois da ação, a pessoa existe e bate com a
// participação. Um caso por caminho — é a rede de segurança da regra "a identidade é uma só".
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const COLS = ['name', 'email', 'phone', 'instagram', 'company', 'job_title', 'bio', 'gender', 'is_plural', 'photo_key', 'reach'];

// A pessoa da participação bate com ela em todas as colunas de identidade.
async function espelhado(guestId, msg) {
  const { rows: [r] } = await h.db.query(
    `SELECT g.person_id, ${COLS.map((c) => `g.${c} AS g_${c}, p.${c} AS p_${c}`).join(', ')}
       FROM guests g LEFT JOIN people p ON p.id = g.person_id WHERE g.id = $1`, [guestId]);
  assert.ok(r, `convidado ${guestId} não existe (${msg})`);
  assert.ok(r.person_id, `convidado sem pessoa: ${msg}`);
  for (const c of COLS) assert.deepEqual(r[`p_${c}`], r[`g_${c}`], `${c} não espelhou: ${msg}`);
  return r;
}

describe('pessoas: todos os escritores espelham', () => {
  let srv; let gestao;
  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Gestora', email: 'gestao@local.test', role: 'gestao', projects: [1, 2] });
    srv = await h.startServer();
    gestao = h.client(srv.base);
    await gestao.login('gestao@local.test');
  });
  after(async () => { await srv.close(); await h.db.close(); });

  it('formulário: cadastrar e editar', async () => {
    const r = await gestao.act('/convidados', {
      name: 'Dr. Márcio Martins', instagram: 'drmarcio', profile: 'medico', status: 'prospect', gender: 'm',
      email: 'marcio@exemplo.com', phone: '48999720273', project_id: '1', confirmar_duplicata: '1',
    }, { from: '/convidados/novo' });
    const id = Number(String(r.location || '').match(/\/convidados\/(\d+)/)[1]);
    const p = await espelhado(id, 'cadastro novo');
    assert.equal(p.p_name, 'Dr. Márcio Martins');

    await gestao.act(`/convidados/${id}`, {
      name: 'Dr. Márcio Martins', instagram: 'drmarcio', profile: 'medico', status: 'prospect', gender: 'm',
      email: '', phone: '4830000000', company: 'Clínica Martins', reach: '120 mil',
    }, { from: `/convidados/${id}/editar` });
    const p2 = await espelhado(id, 'edição');
    assert.deepEqual([p2.p_email, p2.p_phone, p2.p_company, p2.p_reach], [null, '4830000000', 'Clínica Martins', '120 mil']);
  });

  it('confirmar o agendamento (e-mail e telefone na janela da agenda)', async () => {
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, instagram, status, project_id) VALUES ('Dra. Agenda', 'draagenda', 'em_agendamento', 1) RETURNING id");
    await require('../src/services/people').sync(g.id);
    await gestao.act(`/convidados/${g.id}/avancar`, {
      para: 'agendado', agenda: '1', email: 'agenda@exemplo.com', phone: '48911112222', proposed_at: '2026-12-01T10:00',
      scheduled_studio: 'on', scheduled_hosts: 'on', scheduled_guest: 'on',
    }, { from: `/convidados/${g.id}` });
    const p = await espelhado(g.id, 'confirmar agendamento');
    assert.deepEqual([p.p_email, p.p_phone], ['agenda@exemplo.com', '48911112222']);
  });

  it('edição em massa (gênero é da pessoa)', async () => {
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, status, project_id, gender) VALUES ('Dupla Saúde', 'prospect', 1, 'm') RETURNING id");
    await require('../src/services/people').sync(g.id);
    await gestao.act('/convidados/em-massa', { ids: [String(g.id)], gender: 'f' }, { from: '/convidados?view=lista' });
    const p = await espelhado(g.id, 'edição em massa');
    assert.equal(p.p_gender, 'f');
  });

  it('foto do convidado', async () => {
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, status, project_id) VALUES ('Dr. Foto', 'prospect', 1) RETURNING id");
    await require('../src/services/people').sync(g.id);
    await h.db.query('UPDATE guests SET photo_key = $2 WHERE id = $1', [g.id, 'pp/convidados/foto-nova.jpg']);
    await require('../src/services/people').sync(g.id);
    const p = await espelhado(g.id, 'foto');
    assert.equal(p.p_photo_key, 'pp/convidados/foto-nova.jpg');
  });

  it('importação de planilha', async () => {
    const svc = require('../src/services/guestImport');
    const user = (await h.db.query("SELECT * FROM users WHERE email = 'gestao@local.test'")).rows[0];
    const csv = 'nome,instagram,perfil,telefone\nDra. Planilha,draplanilha,medico,48933334444\n';
    const out = await svc.importGuests(csv, user, 1);
    assert.equal(out.created.length, 1, out.headerError || 'nada importado');
    await espelhado(out.created[0], 'importação');
  });

  it('lead do site', async () => {
    const leads = require('../src/services/siteLeads');
    const { id } = await leads.createGuest({ name: 'Dr. Site', instagram: 'drsite', phone: '+5548955556666', email: 'site@exemplo.com', profile: 'medico', topic: 'Quero participar', utm: null });
    await espelhado(id, 'lead do site');
  });

  it('convidado criado junto com o episódio', async () => {
    const r = await gestao.act('/episodios', {
      origem: 'novo_convidado', guest_name: 'Dra. Episódio', guest_instagram: 'draepisodio', guest_profile: 'medico',
      title: 'Conversa com a Dra. Episódio', recorded_on: '2026-11-10', project_id: '1',
    }, { from: '/episodios/novo' });
    assert.ok([302, 303].includes(r.status), `esperava redirecionar, veio ${r.status}`);
    const { rows: [g] } = await h.db.query("SELECT id FROM guests WHERE name = 'Dra. Episódio'");
    await espelhado(g.id, 'convidado do episódio');
  });
});
