// Ações do assistente: o que ele FAZ no sistema quando a pessoa pede. Cada ação respeita o perfil de quem pede, usa as mesmas regras
// das telas (nada de atalho) e deixa registro na auditoria como "pelo assistente".
// Ações com efeito maior (mudar etapa, selecionar na plateia, cancelar cobrança) têm dupla checagem: sem confirmado=true, a ferramenta só
// devolve o resumo e o assistente precisa mostrar à pessoa e perguntar antes de chamar de novo.
const db = require('../db/pool');
const C = require('../constants');
const tasksSvc = require('./tasks');
const commentsSvc = require('./comments');
const rules = require('./guestRules');
const lookup = require('./assistantLookup');
const { audit } = require('./audit');
const { can } = require('../permissions');
const fmt = require('../utils/format');

const DENIED = (what) => ({ erro: `O perfil de quem pediu não ${what}.` });
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const hhmm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : '');
const log = (user, action, type, id, meta = {}) => audit({ user, ip: 'assistente' }, `assistente.${action}`, type, id, meta);
const needConfirm = (resumo) => ({ precisa_confirmar: true, resumo, instrucao: 'Mostre este resumo à pessoa, pergunte se confirma e só depois chame a ferramenta de novo com confirmado=true. Não confirme por conta própria.' });
const brlToCents = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

// "convidado" | "patrocinador" | "episodio" | "tarefa" -> item achado
const FINDERS = {
  convidado: { type: 'guest', find: lookup.guest, name: (r) => r.name, url: (r) => `/convidados/${r.id}` },
  patrocinador: { type: 'sponsor', find: lookup.sponsor, name: (r) => r.company, url: (r) => `/patrocinadores/${r.id}` },
  episodio: { type: 'episode', find: lookup.episode, name: (r) => r.title, url: (r) => `/episodios/${r.id}` },
  tarefa: { type: 'task', find: lookup.task, name: (r) => r.title, url: (r) => `/tarefas/${r.id}` },
};

// Pedido da plateia por id ou nome (opcionalmente restrito ao convidado da gravação).
async function findLead(ref, convidado) {
  const term = String(ref || '').trim();
  if (!term) return { erro: 'Diga qual pedido (o nome da pessoa ou o id).' };
  if (/^\d+$/.test(term)) { const { rows: [l] } = await db.query('SELECT * FROM plateia_leads WHERE id = $1', [term]); if (l) return { row: l }; }
  const p = [lookup.like(term)]; let w = 'name ILIKE $1';
  if (convidado) { p.push(lookup.like(convidado)); w += ' AND guest_name ILIKE $2'; }
  const { rows } = await db.query(`SELECT * FROM plateia_leads WHERE ${w} ORDER BY created_at DESC LIMIT 8`, p);
  if (!rows.length) return { erro: `Pedido da plateia não encontrado: "${term}".` };
  const exact = rows.filter((r) => lookup.norm(r.name) === lookup.norm(term));
  if (exact.length === 1) return { row: exact[0] };
  if (rows.length === 1) return { row: rows[0] };
  return { erro: `Mais de um pedido combina com "${term}". Pergunte qual é.`, opcoes: rows.slice(0, 6).map((r) => `${r.name} (${r.guest_name}, id ${r.id})`) };
}

const TOOLS = [
  {
    perm: 'tasks.write',
    decl: { name: 'criar_tarefa', description: 'Cria uma tarefa. SÓ use quando a pessoa pedir claramente para criar/anotar uma tarefa. Sem responsavel, fica com quem pediu; com responsavel (nome de alguém da equipe), a pessoa recebe o aviso. vencimento AAAA-MM-DD; hora (opcional) HH:MM, horário de Brasília (só a hora vale hoje). tipo: geral, cortes, bastidores, extra ou outro. episodio, convidado e patrocinador ligam a tarefa ao item (nome ou número).', parameters: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, descricao: { type: 'STRING' }, vencimento: { type: 'STRING' }, hora: { type: 'STRING' }, responsavel: { type: 'STRING' }, tipo: { type: 'STRING' }, episodio: { type: 'STRING' }, convidado: { type: 'STRING' }, patrocinador: { type: 'STRING' } }, required: ['titulo'] } },
    async run(a, user) {
      let assignee = user;
      if (a.responsavel && !/^(eu|mim|eu mesm[oa])$/i.test(String(a.responsavel).trim())) {
        const r = await lookup.user(a.responsavel); if (r.erro) return r; assignee = r.row;
      }
      const links = {};
      for (const [field, key, finder] of [['episodio', 'episodeId', lookup.episode], ['convidado', 'guestId', lookup.guest], ['patrocinador', 'sponsorId', lookup.sponsor]]) {
        if (!a[field]) continue;
        const r = await finder(a[field]); if (r.erro) return r; links[key] = r.row.id;
      }
      const { values, error } = tasksSvc.parse({ title: a.titulo, description: a.descricao || '', due_on: isoDate(a.vencimento), due_time: hhmm(a.hora), kind: C.TASK_KINDS[a.tipo] ? a.tipo : 'geral' });
      if (error) return { erro: error };
      const t = await tasksSvc.create({ values, user, assigneeId: assignee.id, links, notifyAssignee: String(assignee.id) !== String(user.id) });
      await log(user, 'tarefa_criada', 'task', t.id, { titulo: t.title, responsavel: assignee.name });
      return { criada: true, titulo: t.title, responsavel: assignee.name, vence: t.due_on ? fmt.formatDue(t.due_on, t.due_time) : null, link: `/tarefas/${t.id}` };
    },
  },
  {
    perm: 'tasks.write',
    decl: { name: 'atualizar_tarefa', description: 'Muda uma tarefa existente: status (a_fazer, fazendo, feito, bloqueada com motivo), título, prazo (vencimento AAAA-MM-DD ou "limpar"), hora (HH:MM) e responsável (nome). tarefa: o título ou o id (veja "tarefas"). Só quem criou, o responsável ou a gestão/produção mexem. Use quando a pessoa pedir ("conclua", "passe para...", "mude o prazo").', parameters: { type: 'OBJECT', properties: { tarefa: { type: 'STRING' }, status: { type: 'STRING', enum: ['a_fazer', 'fazendo', 'feito', 'bloqueada'] }, motivo_bloqueio: { type: 'STRING' }, titulo_novo: { type: 'STRING' }, vencimento: { type: 'STRING' }, hora: { type: 'STRING' }, responsavel: { type: 'STRING' } }, required: ['tarefa'] } },
    async run(a, user) {
      const found = await lookup.task(a.tarefa); if (found.erro) return found;
      const task = await tasksSvc.get(found.row.id);
      if (!tasksSvc.canEdit(user, task)) return { erro: 'Só quem criou, o responsável ou a gestão/produção mexem nesta tarefa.' };
      const body = {};
      if (a.titulo_novo) body.title = a.titulo_novo;
      if (a.status) { if (!tasksSvc.STATUSES.includes(a.status)) return { erro: 'Status inválido.' }; body.status = a.status; body.block_reason = a.motivo_bloqueio || ''; }
      if (a.vencimento) body.due_on = /^limpar$/i.test(a.vencimento) ? '' : isoDate(a.vencimento) || 'invalido';
      if (a.hora !== undefined && a.hora !== '') body.due_time = /^limpar$/i.test(a.hora) ? '' : hhmm(a.hora) || 'invalido';
      if (body.due_time && body.due_time !== 'invalido' && body.due_on === undefined && !task.due_on) body.due_on = tasksSvc.todayISO(); // só a hora: vale hoje
      if (body.due_on === 'invalido' || body.due_time === 'invalido') return { erro: 'Prazo inválido: use AAAA-MM-DD e HH:MM.' };
      let assigneeId;
      if (a.responsavel) { const r = /^(ninguem|ninguém|ninguem)$/i.test(a.responsavel) ? { row: { id: null, name: 'ninguém' } } : await lookup.user(a.responsavel); if (r.erro) return r; assigneeId = r.row.id; }
      if (!Object.keys(body).length && assigneeId === undefined) return { erro: 'Diga o que mudar: status, prazo, hora, título ou responsável.' };
      const { values, error } = tasksSvc.parse(body, { partial: true });
      if (error) return { erro: error };
      const result = await tasksSvc.update(task, values, user, { assigneeId });
      if (result.error) return { erro: result.error };
      const t = result.task;
      await log(user, 'tarefa_atualizada', 'task', t.id, { campos: Object.keys(body).concat(assigneeId !== undefined ? ['responsavel'] : []) });
      return { atualizada: true, titulo: t.title, status: C.TASK_STATUSES[t.status], vence: t.due_on ? fmt.formatDue(t.due_on, t.due_time) : null, link: `/tarefas/${t.id}` };
    },
  },
  {
    perm: 'comments.write',
    decl: { name: 'comentar', description: 'Publica um comentário de texto em um item (convidado, patrocinador, episodio ou tarefa). Use @Nome para avisar alguém da equipe. SÓ use quando a pessoa pedir para comentar/anotar no item; o comentário sai em nome dela.', parameters: { type: 'OBJECT', properties: { tipo: { type: 'STRING', enum: ['convidado', 'patrocinador', 'episodio', 'tarefa'] }, referencia: { type: 'STRING' }, texto: { type: 'STRING' } }, required: ['tipo', 'referencia', 'texto'] } },
    async run({ tipo, referencia, texto }, user) {
      const f = FINDERS[tipo]; if (!f) return { erro: 'Tipo inválido.' };
      const r = await f.find(referencia); if (r.erro) return r;
      const res = await commentsSvc.add({ type: f.type, id: r.row.id, author: user, body: texto });
      if (res.error) return { erro: res.error };
      await log(user, 'comentario', f.type, r.row.id, { comentario: res.comment.id });
      return { publicado: true, em: f.name(r.row), mencoes: res.comment.mentions && res.comment.mentions.length ? res.comment.mentions.length : undefined, link: `${f.url(r.row)}#comentarios` };
    },
  },
  {
    perm: null,
    decl: { name: 'registrar_abordagem', description: 'Registra uma abordagem de follow-up já feita com um convidado (em "Convite enviado") ou patrocinador (em "Prospecção"). canal: instagram, email, whatsapp, telefone ou outro. resultado: enviado (enviei) ou respondeu. quando: AAAA-MM-DD (padrão hoje, até 60 dias atrás). Use quando a pessoa disser que abordou/mandou mensagem/recebeu resposta.', parameters: { type: 'OBJECT', properties: { tipo: { type: 'STRING', enum: ['convidado', 'patrocinador'] }, nome: { type: 'STRING' }, canal: { type: 'STRING', enum: ['instagram', 'email', 'whatsapp', 'telefone', 'outro'] }, resultado: { type: 'STRING', enum: ['enviado', 'respondeu'] }, endereco: { type: 'STRING' }, observacao: { type: 'STRING' }, quando: { type: 'STRING' } }, required: ['tipo', 'nome', 'canal'] } },
    async run(a, user) {
      const outreach = require('./outreach');
      const kind = a.tipo === 'patrocinador' ? 'sponsor' : 'guest';
      if (!can(user.role, kind === 'guest' ? 'guests.write' : 'sponsors.write')) return DENIED(`registra abordagens de ${a.tipo === 'patrocinador' ? 'patrocinadores' : 'convidados'}`);
      const r = await (kind === 'guest' ? lookup.guest : lookup.sponsor)(a.nome); if (r.erro) return r;
      const stage = outreach.KINDS[kind].stage;
      const current = kind === 'guest' ? r.row.status : r.row.stage;
      if (current !== stage) return { erro: `A cadência vale para ${kind === 'guest' ? 'convidados em "Convite enviado"' : 'patrocinadores em "Prospecção"'}; ${kind === 'guest' ? r.row.name : r.row.company} está em outra etapa.`, link: `${outreach.KINDS[kind].base}/${r.row.id}` };
      const body = { canal: a.canal, addr: a.endereco ? '__novo' : '', novo: a.endereco || '', resultado: a.resultado || 'enviado', nota: a.observacao || '', quando: isoDate(a.quando) };
      const res = await outreach.register(kind, r.row.id, body, user.id);
      if (res.error) return { erro: res.error };
      await log(user, 'abordagem', kind, r.row.id, { canal: res.attempt.channel, resultado: res.attempt.result });
      const ev = (await outreach.evaluateAll(kind, { ids: [r.row.id] })).get(r.row.id);
      return {
        registrada: true, em: kind === 'guest' ? r.row.name : r.row.company, canal: outreach.CHANNELS[res.attempt.channel], resultado: outreach.RESULTS[res.attempt.result],
        proximo_follow_up: ev && ev.due ? fmt.formatDay(ev.due) : undefined, aviso: ev && ev.state === 'possivel_perdido' ? 'Já foram todas as tentativas da cadência: se não houve resposta, vale marcar como perdido.' : undefined,
        link: `${outreach.KINDS[kind].base}/${r.row.id}#abordagens`,
      };
    },
  },
  {
    perm: null,
    decl: { name: 'definir_responsavel', description: 'Troca quem é responsável por um convidado, patrocinador ou tarefa, ou o editor de um episódio. responsavel: nome de alguém da equipe, ou "ninguém" para tirar. A pessoa nova recebe um aviso.', parameters: { type: 'OBJECT', properties: { tipo: { type: 'STRING', enum: ['convidado', 'patrocinador', 'tarefa', 'episodio'] }, referencia: { type: 'STRING' }, responsavel: { type: 'STRING' } }, required: ['tipo', 'referencia', 'responsavel'] } },
    async run({ tipo, referencia, responsavel }, user) {
      const f = FINDERS[tipo]; if (!f) return { erro: 'Tipo inválido.' };
      const item = await f.find(referencia); if (item.erro) return item;
      let target = null;
      if (!/^(ninguem|ninguém)$/i.test(String(responsavel).trim())) { const u = await lookup.user(responsavel); if (u.erro) return u; target = u.row; }
      const res = await require('./responsible').setResponsible({ type: f.type, id: item.row.id, userId: target ? target.id : null, actor: user });
      if (res.error) return { erro: res.error };
      await log(user, 'responsavel', f.type, item.row.id, { para: target ? target.name : null });
      return { feito: true, item: f.name(item.row), responsavel: target ? target.name : 'ninguém', link: f.url(item.row) };
    },
  },
  {
    perm: 'guests.write',
    decl: { name: 'mudar_etapa_convidado', description: 'Muda a etapa de um convidado no CRM, com as mesmas regras do painel (foto, contato, data e confirmações, motivo da perda). Etapas: prospect, convite_enviado, em_agendamento, agendado, gravado, perdido, cancelado. Para "perdido" informe motivo_perda (Recusado, Sem agenda próxima, Nunca respondeu, Parou de responder, Conflito de interesse ou Outros com descrição). Se faltar algo que o assistente não consegue preencher (foto, data da gravação), a ferramenta diz o que falta e o link. SEMPRE mostre o resumo e peça confirmação antes (confirmado=true só depois do sim).', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, etapa: { type: 'STRING' }, motivo_perda: { type: 'STRING' }, descricao_da_perda: { type: 'STRING' }, confirmado: { type: 'BOOLEAN' } }, required: ['nome', 'etapa'] } },
    async run(a, user) {
      const r = await lookup.guest(a.nome); if (r.erro) return r;
      const g = r.row;
      const target = rules.normalizeStatus(a.etapa);
      if (!target) return { erro: `Etapa desconhecida. Use: ${C.GUEST_STATUSES.map((s) => s.label).join(', ')}.` };
      if (target === g.status) return { erro: `${g.name} já está em ${C.STATUS_BY_KEY[target].label}.` };
      let candidate = { ...g };
      if (target === 'perdido') {
        const reason = rules.normalizeLossReason(a.motivo_perda);
        if (reason) candidate = { ...g, loss_reason: reason, loss_note: fmt.clean(a.descricao_da_perda, 500) || null };
      }
      const missing = rules.missingFor(target, candidate);
      if (missing.length) return { erro: rules.missingMessage(C.STATUS_BY_KEY[target].label, missing), link: `/convidados/${g.id}`, observacao: 'O assistente não preenche foto nem data da gravação: a pessoa completa na página do convidado.' };
      const resumo = `${g.name}: ${C.STATUS_BY_KEY[g.status].label} → ${C.STATUS_BY_KEY[target].label}${target === 'perdido' ? ` (motivo: ${C.LOSS_REASONS[candidate.loss_reason]})` : ''}${target === 'gravado' ? '. Isso cria o episódio.' : ''}`;
      if (a.confirmado !== true) return needConfirm(resumo);
      if (target === 'perdido') await db.query('UPDATE guests SET status = $2, loss_reason = $3, loss_note = $4, updated_at = now() WHERE id = $1', [g.id, target, candidate.loss_reason, candidate.loss_note]);
      else await db.query('UPDATE guests SET status = $2, updated_at = now() WHERE id = $1', [g.id, target]);
      await require('./guests').addEvent(g.id, user.id, 'status', `Etapa: ${C.STATUS_BY_KEY[g.status].label} → ${C.STATUS_BY_KEY[target].label} (pelo assistente, a pedido de ${user.name})`);
      await require('./production').syncFromGuest(g.id, user.id);
      await log(user, 'etapa_convidado', 'guest', g.id, { de: g.status, para: target });
      return { feito: true, resumo, link: `/convidados/${g.id}` };
    },
  },
  {
    perm: 'episodes.read',
    decl: { name: 'avancar_episodio', description: 'Move um episódio para outra etapa da produção quando o perfil de quem pede pode e nada falta (liberar para edição, assumir edição, enviar para revisão, aprovar, pedir ajustes, finalizar, publicar). episodio: número ou título. para: a etapa de destino (use as de "episodios" > proximos_passos). SEMPRE mostre o resumo e peça confirmação antes (confirmado=true só depois do sim).', parameters: { type: 'OBJECT', properties: { episodio: { type: 'STRING' }, para: { type: 'STRING' }, confirmado: { type: 'BOOLEAN' } }, required: ['episodio', 'para'] } },
    async run({ episodio, para, confirmado }, user) {
      const prod = require('./production');
      const r = await lookup.episode(episodio); if (r.erro) return r;
      const ep = r.row;
      const wanted = lookup.norm(para);
      const stage = C.EPISODE_STAGES.find((s) => lookup.norm(s.key) === wanted || lookup.norm(s.label) === wanted);
      const moves = await prod.availableMoves(ep, user.role);
      const move = moves.find((m) => (stage && m.to === stage.key) || lookup.norm(m.label) === wanted);
      if (!move) return { erro: `Daqui (${C.EPISODE_STATUSES[ep.status]}) o episódio só pode ir para: ${moves.map((m) => `${m.label} (${C.EPISODE_STATUSES[m.to]})`).join('; ') || 'nenhuma etapa'}.` };
      if (!move.allowed) return { erro: `O perfil de quem pediu não faz "${move.label}"${move.who ? `; quem faz: ${move.who}` : ''}.` };
      if (move.missing.length) return { erro: `Para "${move.label.toLowerCase()}" falta: ${move.missing.join(' · ')}.`, link: `/episodios/${ep.id}` };
      const resumo = `EP.${String(ep.number || 0).padStart(3, '0')} ${ep.title}: ${C.EPISODE_STATUSES[ep.status]} → ${C.EPISODE_STATUSES[move.to]} ("${move.label}")`;
      if (confirmado !== true) return needConfirm(resumo);
      const res = await prod.move(ep, move.to, user);
      if (res.error) return { erro: res.error };
      await log(user, 'etapa_episodio', 'episode', ep.id, { de: ep.status, para: move.to });
      return { feito: true, resumo, link: `/episodios/${ep.id}` };
    },
  },
  {
    perm: 'audience.read',
    decl: { name: 'plateia_adicionar', description: 'Adiciona uma pessoa à plateia de uma gravação (convidado Agendado com data). nome, whatsapp (com DDD; pais padrão BR), convidado (nome do convidado da gravação). situacao: "novo" (padrão) ou "selecionado" (nesse caso informe valor em reais OU isento=true, e peça confirmação: confirmado=true só depois do sim).', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, whatsapp: { type: 'STRING' }, pais: { type: 'STRING' }, convidado: { type: 'STRING' }, situacao: { type: 'STRING', enum: ['novo', 'selecionado'] }, valor: { type: 'NUMBER' }, isento: { type: 'BOOLEAN' }, confirmado: { type: 'BOOLEAN' } }, required: ['nome', 'whatsapp', 'convidado'] } },
    async run(a, user) {
      const audience = require('./audience');
      const name = fmt.clean(a.nome, 120); if (!name) return { erro: 'Informe o nome da pessoa.' };
      const phone = audience.validatePhone(String(a.pais || 'BR').toUpperCase(), a.whatsapp); if (phone.error) return { erro: phone.error };
      const g = await lookup.guest(a.convidado); if (g.erro) return g;
      if (g.row.status !== 'agendado' || !g.row.proposed_at) return { erro: `${g.row.name} não está Agendado com data: só dá para adicionar pessoas a gravações agendadas.` };
      const selected = a.situacao === 'selecionado';
      const cents = a.isento ? 0 : brlToCents(a.valor);
      if (selected && cents == null) return { erro: 'Para já selecionar, informe o valor combinado em reais ou diga que é isento.' };
      const resumo = `Adicionar ${name} (${phone.display}) à plateia de ${g.row.name}${selected ? `, já selecionado(a), ${a.isento ? 'isento(a)' : `valor ${fmt.formatBRL(cents)}`}` : ', como novo pedido'}`;
      if (selected && a.confirmado !== true) return needConfirm(resumo);
      const added = await audience.addLead({ guest: g.row, name, phone, userId: user.id });
      if (added.duplicate) return { erro: 'Essa pessoa (mesmo WhatsApp) já está nessa gravação.' };
      if (selected) {
        const done = await audience.confirmLead(added.lead, { amountCents: cents, dueOn: audience.todayISO(), paidOn: null, exempt: Boolean(a.isento) }, user.id);
        if (done.error) return { erro: `${name} foi adicionado(a), mas não consegui selecionar: ${done.error}`, link: `/plateia/painel?convidado=${g.row.id}` };
      }
      await log(user, 'plateia_adicionar', 'plateia_lead', added.lead.id, { convidado: g.row.id, selecionado: selected });
      return { adicionado: true, resumo, link: `/plateia/painel?convidado=${g.row.id}` };
    },
  },
  {
    perm: 'audience.read',
    decl: { name: 'plateia_situacao', description: 'Muda a situação de um pedido da plateia para: novo, em_atendimento (em avaliação; gera o link de pagamento se a InfinitePay está ativa), nao_selecionado ou desistiu. Para SELECIONAR use plateia_selecionar. pedido: nome da pessoa ou id; convidado ajuda a desempatar. Se o pedido está Selecionado, sair dessa situação cancela a conta a receber ainda não paga: peça confirmação (confirmado=true só depois do sim).', parameters: { type: 'OBJECT', properties: { pedido: { type: 'STRING' }, convidado: { type: 'STRING' }, situacao: { type: 'STRING', enum: ['novo', 'em_atendimento', 'nao_selecionado', 'desistiu'] }, confirmado: { type: 'BOOLEAN' } }, required: ['pedido', 'situacao'] } },
    async run({ pedido, convidado, situacao, confirmado }, user) {
      const audience = require('./audience');
      const LABEL = { novo: 'Novo pedido', em_atendimento: 'Em avaliação', nao_selecionado: 'Não selecionado', desistiu: 'Desistiu', confirmado: 'Selecionado' };
      if (!LABEL[situacao] || situacao === 'confirmado') return { erro: 'Situação inválida. Para selecionar, use plateia_selecionar.' };
      const r = await findLead(pedido, convidado); if (r.erro) return r;
      const lead = r.row;
      if (lead.status === situacao) return { erro: `${lead.name} já está em ${LABEL[situacao]}.` };
      const resumo = `${lead.name} (${lead.guest_name}): ${LABEL[lead.status]} → ${LABEL[situacao]}${lead.status === 'confirmado' ? '. A conta a receber que ainda não foi paga será cancelada.' : ''}`;
      if (lead.status === 'confirmado' && confirmado !== true) return needConfirm(resumo);
      const out = await audience.changeStatus(lead, situacao, user.id);
      await log(user, 'plateia_situacao', 'plateia_lead', lead.id, { de: lead.status, para: situacao });
      return { feito: true, resumo, link_de_pagamento_criado: out.link ? fmt.formatBRL(Number(out.link.amount_cents)) : undefined, aviso: out.linkError ? `Não consegui gerar o link de pagamento: ${out.linkError}` : (out.kept ? 'O pagamento já recebido continua nas contas do financeiro.' : undefined), link: `/plateia/painel?convidado=${lead.guest_id}` };
    },
  },
  {
    perm: 'audience.read',
    decl: { name: 'plateia_selecionar', description: 'Seleciona um pedido da plateia (confirma a participação): informe o valor combinado em reais (vira conta a receber no Financeiro) OU isento=true, ou recebido=true se já pagou. pedido: nome da pessoa ou id. SEMPRE mostre o resumo e peça confirmação antes (confirmado=true só depois do sim).', parameters: { type: 'OBJECT', properties: { pedido: { type: 'STRING' }, convidado: { type: 'STRING' }, valor: { type: 'NUMBER' }, isento: { type: 'BOOLEAN' }, recebido: { type: 'BOOLEAN' }, confirmado: { type: 'BOOLEAN' } }, required: ['pedido'] } },
    async run(a, user) {
      const audience = require('./audience');
      const r = await findLead(a.pedido, a.convidado); if (r.erro) return r;
      const lead = r.row;
      if (lead.status === 'confirmado') return { erro: `${lead.name} já está selecionado(a).` };
      const cents = a.isento ? 0 : brlToCents(a.valor);
      if (cents == null) return { erro: 'Informe o valor combinado em reais ou diga que a participação é isenta.' };
      const resumo = `Selecionar ${lead.name} na gravação de ${lead.guest_name}: ${a.isento ? 'isento(a), sem cobrança' : `${fmt.formatBRL(cents)}${a.recebido ? ' (já recebido)' : ' (a receber, vira conta no Financeiro)'}`}`;
      if (a.confirmado !== true) return needConfirm(resumo);
      const done = await audience.confirmLead(lead, { amountCents: cents, dueOn: audience.todayISO(), paidOn: !a.isento && a.recebido ? audience.todayISO() : null, exempt: Boolean(a.isento) }, user.id);
      if (done.error) return { erro: done.error };
      await log(user, 'plateia_selecionar', 'plateia_lead', lead.id, { valor: cents, isento: Boolean(a.isento) });
      return { feito: true, resumo, link: `/plateia/painel?convidado=${lead.guest_id}` };
    },
  },
];

module.exports = { TOOLS, needConfirm };
