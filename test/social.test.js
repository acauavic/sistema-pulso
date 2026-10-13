const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const social = require('../src/services/social');
const up = require('../src/services/uploadPost');

describe('Social', () => {
  const as = {};
  let app; let ep; let clipA; let clipB; let quote; let story; let slides; let editor;
  const realFetch = global.fetch;
  let ideasReply = null; let geminiCalls = 0;
  const calls = (pred) => h.uploadPostCalls.filter(pred);
  const fieldsOf = (c) => (c.fields || []).reduce((o, [k, v]) => { (o[k] ||= []).push(v); return o; }, {});
  const withLive = async (fn) => { config.uploadPost.live = true; try { return await fn(); } finally { config.uploadPost.live = false; } };

  before(async () => {
    process.env.GEMINI_KEY = 'test-gemini'; config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiCalls += 1;
        const prompt = JSON.parse(opts.body).contents[0].parts.map((p) => p.text || '').join('\n');
        global.lastIdeasPrompt = prompt;
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(ideasReply) }] } }], usageMetadata: { totalTokenCount: 10 } });
      }
      return realFetch(url, opts);
    };
    await h.resetDb();
    app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) {
      const u = await h.createUser({ name: `${k} pessoa`, email: `${k}@t.com`, role });
      if (k === 'editor') editor = u;
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
    const { rows: [g] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status) VALUES ('Dra. Social', 'dra.social', 'medico', 'gravado') RETURNING id");
    ep = (await h.db.query("INSERT INTO episodes (number, title, status, guest_id, editor_id) VALUES (30, 'Conversa com Dra. Social', 'em_finalizacao', $1, $2) RETURNING *", [g.id, editor.id])).rows[0];
    const segs = Array.from({ length: 40 }, (_, i) => ({ start_ms: i * 15000, end_ms: i * 15000 + 14000, text: `Trecho ${i}: médico que não entende de negócio vira refém do próprio consultório, e isso muda tudo na carreira.` }));
    await h.db.query('INSERT INTO episode_transcripts (episode_id, text, segments) VALUES ($1, $2, $3)', [ep.id, segs.map((s) => s.text).join(' '), JSON.stringify(segs)]);
    const mkClip = async (title) => (await h.db.query("INSERT INTO episode_clips (episode_id, title, post_title, caption, status, source, storage_key, duration_ms) VALUES ($1,$2,$2,'Legenda do corte','pronto','upload',$3,45000) RETURNING *", [ep.id, title, `pp/cortes/x/${title}.mp4`])).rows[0];
    clipA = await mkClip('Negócio na medicina');
    clipB = await mkClip('Refém do consultório');
    const mkCover = async (kind, w, hgt, group = null, pos = 0) => {
      const key = `pp/capas/${kind}-${pos}-${Math.random().toString(36).slice(2)}.jpg`;
      h.b2Store.set(key, { body: Buffer.from('jpg'), contentType: 'image/jpeg' });
      return (await h.db.query("INSERT INTO episode_covers (episode_id, kind, group_key, position, label, spec, storage_key, mime, width, height, size_bytes) VALUES ($1,$2,$3,$4,$5,'{}',$6,'image/jpeg',$7,$8,3) RETURNING *",
        [ep.id, kind, group, pos, `${kind} ${pos}`, key, w, hgt])).rows[0];
    };
    quote = await mkCover('post_quote', 1080, 1350);
    story = await mkCover('reel_cover', 1080, 1920);
    slides = [await mkCover('carousel', 1080, 1350, 'g1', 0), await mkCover('carousel', 1080, 1350, 'g1', 1), await mkCover('carousel', 1080, 1350, 'g1', 2)];
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  describe('acesso e navegação', () => {
    it('equipe de conteúdo vê; editor de vídeo não; só a gestão publica e automatiza', async () => {
      assert.equal((await as.editor.get('/social/publicacoes')).status, 403);
      const page = await as.prod.get('/social/publicacoes');
      assert.equal(page.status, 200);
      assert.match(page.text, /Modo de teste/);
      assert.equal((await as.editor.act('/social/publicar', { tipo: 'video', clip_id: String(clipA.id), platforms: 'tiktok', title: 'x', confirmar: '1' }, { from: '/social/novo' })).status, 403);
      assert.equal((await as.prod.act('/social/automacoes', { name: 'x', message: 'y' }, { from: '/social/automacoes' })).status, 403);
      assert.match((await as.gestao.get('/')).text, /href="\/social"/, 'item Social na barra lateral');
    });
  });

  describe('novo post: só o que ainda não foi usado', () => {
    it('lista cortes, posts, carrosséis e stories sem uso', async () => {
      let t = (await as.gestao.get('/social/novo')).text;
      assert.match(t, /Negócio na medicina/); assert.match(t, /Refém do consultório/);
      assert.match((await as.gestao.get('/social/novo?tipo=imagem')).text, new RegExp(`/capas/${quote.id}/imagem`));
      t = (await as.gestao.get('/social/novo?tipo=carrossel')).text;
      assert.match(t, new RegExp(`value="${slides.map((s) => s.id).join(',')}"`), 'carrossel = slides na ordem');
      assert.match((await as.gestao.get('/social/novo?tipo=story')).text, new RegExp(`/capas/${story.id}/imagem`), 'capa vertical serve de story');
    });

    it('corte publicado em modo de teste continua disponível (marcado como testado); agendado sai da lista', async () => {
      const r = await as.gestao.act('/social/publicar', { tipo: 'video', clip_id: String(clipA.id), platforms: ['tiktok', 'instagram'], title: 'Negócio na medicina', description: 'Legenda', confirmar: '1' }, { from: '/social/novo' });
      assert.equal(r.status, 302);
      const { rows: [pub] } = await h.db.query('SELECT * FROM episode_publications WHERE clip_id=$1', [clipA.id]);
      assert.equal(pub.status, 'simulado');
      assert.equal(calls((c) => c.method === 'POST' && c.url.endsWith('/api/upload')).length, 0, 'modo de teste não chama o envio');
      assert.match((await as.gestao.get('/social/novo')).text, /só testado/);
      const when = new Date(Date.now() + 3 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 16);
      await as.gestao.act('/social/publicar', { tipo: 'video', clip_id: String(clipA.id), platforms: 'tiktok', title: 'Negócio na medicina', agendar: when, confirmar: '1' }, { from: '/social/novo' });
      const t = (await as.gestao.get('/social/novo')).text;
      assert.doesNotMatch(t, /Negócio na medicina/, 'agendado já gastou o corte');
      assert.match(t, /Refém do consultório/);
      assert.match((await as.gestao.act('/social/publicar', { tipo: 'video', clip_id: String(clipB.id), platforms: 'tiktok', title: 'x' }, { from: '/social/novo' })).location, /tipo=video/, 'sem confirmar não envia');
    });

    it('post, carrossel e story: validação e envio por /upload_photos (com links assinados, na ordem)', async () => {
      const pub = (b) => as.gestao.act('/social/publicar', { confirmar: '1', ...b }, { from: '/social/novo' });
      let r = await pub({ tipo: 'story', cover_ids: String(story.id), platforms: ['instagram', 'facebook'], title: 'Story' });
      assert.match(r.location, /tipo=story/, 'story só no Instagram');
      r = await pub({ tipo: 'carrossel', cover_ids: String(slides[0].id), platforms: 'instagram', title: 'C', description: 'Legenda' });
      assert.match(r.location, /tipo=carrossel/, 'carrossel com 1 imagem não passa');
      await withLive(async () => {
        r = await pub({ tipo: 'carrossel', cover_ids: slides.map((s) => s.id).join(','), platforms: 'instagram', title: 'Carrossel do episódio', description: 'Três ideias da conversa.' });
        assert.match(r.location, /\/social\/publicacoes\/\d+/);
        const call = calls((c) => c.url.endsWith('/api/upload_photos')).at(-1);
        const f = fieldsOf(call);
        assert.equal(f['photos[]'].length, 3);
        assert.ok(f['photos[]'].every((u) => /^https:\/\/s3\.test-region\.backblazeb2\.com\//.test(u)), 'links assinados do bucket');
        assert.ok(f['photos[]'][0].includes(encodeURIComponent(slides[0].storage_key).split('%2F').pop().slice(0, 10)) || f['photos[]'][0].includes(slides[0].storage_key.split('/').pop()), 'na ordem dos slides');
        assert.deepEqual(f['platform[]'], ['instagram']);
        assert.equal(f.instagram_title[0], 'Três ideias da conversa.');
        r = await pub({ tipo: 'story', cover_ids: String(story.id), platforms: 'instagram' });
        const s = fieldsOf(calls((c) => c.url.endsWith('/api/upload_photos')).at(-1));
        assert.deepEqual(s.media_type, ['STORIES']);
      });
      const { rows } = await h.db.query("SELECT media, cover_ids, status FROM episode_publications WHERE media <> 'video' ORDER BY id");
      assert.deepEqual(rows.map((x) => x.media), ['carrossel', 'story']);
      assert.deepEqual(rows[0].cover_ids, slides.map((x) => x.id));
      assert.doesNotMatch((await as.gestao.get('/social/novo?tipo=carrossel')).text, /carousel 0/, 'carrossel usado sai da lista');
    });
  });

  describe('publicações: ver e editar', () => {
    it('a lista filtra por status e tipo; o detalhe mostra onde saiu', async () => {
      const t = (await as.prod.get('/social/publicacoes')).text;
      assert.match(t, /\[ CARROSSEL \]/); assert.match(t, /\[ VÍDEO \]/);
      assert.doesNotMatch((await as.prod.get('/social/publicacoes?tipo=story')).text, /\[ CARROSSEL \]/);
      assert.match((await as.prod.get('/social/publicacoes?status=agendado')).text, /Agendado/);
      const { rows: [p] } = await h.db.query("SELECT id FROM episode_publications WHERE media='carrossel'");
      const d = await as.prod.get(`/social/publicacoes/${p.id}`);
      assert.equal(d.status, 200);
      assert.match(d.text, /Instagram/);
      assert.doesNotMatch(d.text, /name="title"/, 'produtora não edita');
    });

    it('agendado: muda texto e horário aqui; publicado: edição vai para as redes que deixam (Instagram não)', async () => {
      const { rows: [sched] } = await h.db.query("SELECT * FROM episode_publications WHERE status='agendado'");
      const when = new Date(Date.now() + 5 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 16);
      await as.gestao.act(`/social/publicacoes/${sched.id}`, { title: 'Novo título do corte', description: 'Nova legenda', agendar: when }, { from: `/social/publicacoes/${sched.id}` });
      const s2 = (await h.db.query('SELECT * FROM episode_publications WHERE id=$1', [sched.id])).rows[0];
      assert.equal(s2.title, 'Novo título do corte');
      assert.ok(s2.edited_at);
      assert.ok(Math.abs(new Date(s2.scheduled_at) - new Date(sched.scheduled_at)) > 86400_000);

      const { rows: [pub] } = await h.db.query(
        `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, description, status, results, created_by)
         VALUES ($1, $2, '{youtube,instagram}', 'Publicado', 'Texto', 'publicado', $3, (SELECT id FROM users WHERE role='gestao')) RETURNING *`,
        [ep.id, clipB.id, JSON.stringify([{ platform: 'youtube', ok: true, post_id: 'yt123', url: 'https://youtu.be/yt123' }, { platform: 'instagram', ok: true, post_id: 'ig1', url: 'https://instagram.com/p/ig1' }])]);
      const page = (await as.gestao.get(`/social/publicacoes/${pub.id}`)).text;
      assert.match(page, /YouTube Shorts/);
      assert.match(page, /Instagram Reels não deixa editar/);
      await withLive(async () => {
        await as.gestao.act(`/social/publicacoes/${pub.id}`, { title: 'Título corrigido', description: 'Texto corrigido' }, { from: `/social/publicacoes/${pub.id}` });
      });
      const edit = calls((c) => c.url.endsWith('/api/uploadposts/posts/edit'));
      assert.equal(edit.length, 1, 'só o YouTube recebe a edição');
      assert.deepEqual({ platform: edit[0].json.platform, post_id: edit[0].json.post_id, title: edit[0].json.title }, { platform: 'youtube', post_id: 'yt123', title: 'Título corrigido' });
      assert.equal((await as.prod.act(`/social/publicacoes/${pub.id}`, { title: 'x' }, { from: `/social/publicacoes/${pub.id}` })).status, 403);
    });
  });

  describe('ideias por episódio (com memória)', () => {
    it('gera, descarta o que já foi feito e não repete na segunda vez', async () => {
      ideasReply = { ideias: [
        { tipo: 'corte', titulo: 'Refém do consultório', gancho: 'Já existe como corte', inicio_seg: 10, fim_seg: 70 },
        { tipo: 'corte', titulo: 'Gestão é cuidado com o paciente', gancho: 'Quem não gere, não cuida.', inicio_seg: 120, fim_seg: 175, frase: 'Gestão é cuidado.', legenda: 'Gestão e cuidado andam juntos.' },
        { tipo: 'carrossel', titulo: 'Cinco erros de quem abre clínica', gancho: 'O primeiro é o mais comum.', slides: ['Erro 1', 'Erro 2', 'Erro 3', 'Erro 4', 'Erro 5'] },
        { tipo: 'story', titulo: 'Enquete: você sabe precificar?', gancho: 'Sim ou não?' },
      ] };
      const r = await as.prod.act('/social/ideias/gerar', { episodes: String(ep.id), kinds: ['corte', 'carrossel'] }, { from: '/social/ideias' });
      assert.equal(r.status, 302);
      assert.match(global.lastIdeasPrompt, /NÃO repita[\s\S]*Refém do consultório/, 'o pedido leva o que já foi feito');
      assert.match(global.lastIdeasPrompt, /\[120s\]/, 'transcrição com marcas de tempo');
      let { rows } = await h.db.query('SELECT kind, title FROM social_ideas ORDER BY id');
      assert.deepEqual(rows, [{ kind: 'corte', title: 'Gestão é cuidado com o paciente' }, { kind: 'carrossel', title: 'Cinco erros de quem abre clínica' }], 'repetido e tipo não pedido ficam de fora');
      ideasReply.ideias[1].titulo = 'Gestão é cuidado com paciente'; // quase igual
      await as.prod.act('/social/ideias/gerar', { episodes: String(ep.id), kinds: ['corte', 'carrossel', 'story'] }, { from: '/social/ideias' });
      ({ rows } = await h.db.query('SELECT kind, title FROM social_ideas ORDER BY id'));
      assert.equal(rows.length, 3, 'só o story é novo');
      const page = (await as.prod.get('/social/ideias')).text;
      assert.match(page, /\[ CARROSSEL \]/);
      assert.match(page, /TRECHO 2:00 – 2:55/);
      assert.match(page, /Gestão é cuidado\./);
    });

    it('aprovar vira tarefa (corte vai para o editor do episódio); feita/descartada não volta', async () => {
      const { rows: [corte] } = await h.db.query("SELECT * FROM social_ideas WHERE kind='corte'");
      await as.prod.act(`/social/ideias/${corte.id}/aprovar`, {}, { from: '/social/ideias' });
      const { rows: [i2] } = await h.db.query('SELECT * FROM social_ideas WHERE id=$1', [corte.id]);
      assert.equal(i2.status, 'aprovada');
      const { rows: [t] } = await h.db.query('SELECT * FROM tasks WHERE id=$1', [i2.task_id]);
      assert.equal(t.kind, 'cortes');
      assert.equal(t.assignee_id, editor.id);
      assert.equal(t.episode_id, ep.id);
      assert.match(t.description, /Trecho: 2:00 a 2:55/);
      const { rows: [car] } = await h.db.query("SELECT * FROM social_ideas WHERE kind='carrossel'");
      await as.prod.act(`/social/ideias/${car.id}/descartar`, {}, { from: '/social/ideias' });
      assert.equal((await h.db.query('SELECT status FROM social_ideas WHERE id=$1', [car.id])).rows[0].status, 'descartada');
      const done = await social.doneFor(ep.id);
      assert.ok(done.some((d) => d.title === 'Cinco erros de quem abre clínica'), 'descartada continua na memória');
      assert.equal((await as.editor.act(`/social/ideias/${car.id}/reabrir`, {}, { from: '/social/ideias' })).status, 403);
    });

    it('vários episódios vão para a fila; sem transcrição avisa', async () => {
      const { rows: [e2] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (31, 'Sem fala', 'gravado') RETURNING id");
      const r = await social.generateIdeas(e2.id, ['corte'], null);
      assert.match(r.error, /transcrição/);
      await as.prod.act('/social/ideias/gerar', { episodes: [String(ep.id), String(e2.id)], kinds: 'story' }, { from: '/social/ideias' });
      assert.equal((await h.db.query("SELECT count(*)::int n FROM jobs WHERE kind='social_ideias'")).rows[0].n, 1);
    });
  });

  describe('insights', () => {
    it('mostra os números das redes conectadas e guarda a foto do dia (sem consultar de novo na mesma hora)', async () => {
      const before = calls((c) => c.url.includes('/api/analytics/')).length;
      const t = (await as.prod.get('/social/insights')).text;
      assert.match(t, /1\.200/);
      assert.match(t, /Seguidores/);
      assert.equal(calls((c) => c.url.includes('/api/analytics/')).length, before + 1);
      await as.prod.get('/social/insights');
      assert.equal(calls((c) => c.url.includes('/api/analytics/')).length, before + 1, 'usa a foto guardada');
      await as.prod.get('/social/insights?atualizar=1');
      assert.equal(calls((c) => c.url.includes('/api/analytics/')).length, before + 2);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM social_snapshots')).rows[0].n >= 1, true);
    });
  });

  describe('automações de comentários e directs', () => {
    let rule;
    it('cria pausada; valida direct fora do Instagram e botões sem link', async () => {
      const mk = (b) => as.gestao.act('/social/automacoes', b, { from: '/social/automacoes' });
      assert.match((await mk({ name: 'FB', trigger: 'comentario', platform: 'facebook', action: 'dm', message: 'oi' })).location, /nova=1/);
      assert.match((await mk({ name: 'Botão', trigger: 'comentario', action: 'dm', message: 'oi', button_title_0: 'Ouvir', button_url_0: 'javascript:x' })).location, /nova=1/);
      const r = await mk({ name: 'Link do episódio', trigger: 'comentario', platform: 'instagram', scope: 'recentes', keywords: 'link, Episódio', action: 'ambos', message: 'Aqui está o link.', reply_text: 'Te mandei no direct.', button_title_0: 'Ouvir', button_url_0: 'https://pulso.link/ep30' });
      rule = (await h.db.query("SELECT * FROM social_rules WHERE name='Link do episódio'")).rows[0];
      assert.equal(r.location, `/social/automacoes/${rule.id}`);
      assert.equal(rule.active, false);
      assert.deepEqual(rule.keywords, ['link', 'Episódio']);
      assert.equal(await social.runRules(), 0, 'pausada não roda');
    });

    it('ativa só com confirmação; responde o que chegou depois, uma vez só (modo de teste só registra)', async () => {
      assert.equal((await as.gestao.act(`/social/automacoes/${rule.id}/ativar`, {}, { from: `/social/automacoes/${rule.id}` })).status, 302);
      assert.equal((await h.db.query('SELECT active FROM social_rules WHERE id=$1', [rule.id])).rows[0].active, false);
      await as.gestao.act(`/social/automacoes/${rule.id}/ativar`, { confirmar: '1' }, { from: `/social/automacoes/${rule.id}` });
      const later = new Date(Date.now() + 60_000).toISOString();
      h.uploadPostState.comments.m1 = [
        { id: 'c1', text: 'Quero o LINK do episodio', timestamp: later, user: { id: 'u1', username: 'ana' } },
        { id: 'c2', text: 'Amei a conversa', timestamp: later, user: { id: 'u2', username: 'bia' } },
        { id: 'c0', text: 'link antigo', timestamp: new Date(Date.now() - 86400_000).toISOString(), user: { id: 'u3', username: 'cris' } },
      ];
      const posts = calls((c) => c.method === 'POST' && /comments|dms/.test(c.url)).length;
      assert.equal(await social.runRules(), 1);
      const { rows: ev } = await h.db.query('SELECT external_id, status, author FROM social_events WHERE rule_id=$1 ORDER BY external_id', [rule.id]);
      assert.deepEqual(ev, [{ external_id: 'c1', status: 'simulado', author: 'ana' }, { external_id: 'c2', status: 'ignorado', author: 'bia' }], 'comentário de antes de ativar fica de fora');
      assert.equal(calls((c) => c.method === 'POST' && /comments|dms/.test(c.url)).length, posts, 'modo de teste não responde ninguém');
      assert.equal(await social.runRules(), 0, 'não responde duas vezes');
      const page = (await as.prod.get(`/social/automacoes/${rule.id}`)).text;
      assert.match(page, /Quero o LINK do episodio/);
      assert.match(page, /Simulado/);
    });

    it('ao vivo: direct privado + resposta pública para comentário; direct responde só mensagem de outra pessoa', async () => {
      h.uploadPostState.comments.m1.push({ id: 'c3', text: 'link por favor', timestamp: new Date(Date.now() + 120_000).toISOString(), user: { id: 'u4', username: 'davi' } });
      await withLive(() => social.runRules());
      const dm = calls((c) => c.url.endsWith('/comments/reply')).at(-1).json;
      assert.deepEqual({ comment_id: dm.comment_id, message: dm.message, platform: dm.platform }, { comment_id: 'c3', message: 'Aqui está o link.', platform: 'instagram' });
      assert.deepEqual(dm.buttons, [{ type: 'web_url', title: 'Ouvir', url: 'https://pulso.link/ep30' }]);
      const pub = calls((c) => c.url.endsWith('/comments/create')).at(-1).json;
      assert.deepEqual({ comment_id: pub.comment_id, message: pub.message }, { comment_id: 'c3', message: 'Te mandei no direct.' });
      assert.equal((await h.db.query("SELECT status FROM social_events WHERE rule_id=$1 AND external_id='c3'", [rule.id])).rows[0].status, 'enviado');

      await as.gestao.act('/social/automacoes', { name: 'Direct preço', trigger: 'direct', keywords: 'preço', message: 'Nossa tabela de patrocínio está no media kit.' }, { from: '/social/automacoes' });
      const { rows: [dr] } = await h.db.query("SELECT * FROM social_rules WHERE name='Direct preço'");
      assert.equal(dr.action, 'dm');
      await h.db.query('UPDATE social_rules SET active = true, active_since = now() - interval \'1 minute\' WHERE id=$1', [dr.id]);
      const soon = new Date().toISOString();
      h.uploadPostState.conversations = [{ id: 't1', participants: { data: [{ id: 'me', username: 'pulso' }, { id: 'x9', username: 'marca' }] }, messages: { data: [
        { id: 'd1', created_time: soon, from: { id: 'x9', username: 'marca' }, message: 'Qual o PRECO do patrocínio?' },
        { id: 'd2', created_time: soon, from: { id: 'me', username: 'pulso' }, message: 'preço é no media kit' },
      ] } }];
      await withLive(() => social.runRules());
      const send = calls((c) => c.url.endsWith('/dms/send'));
      assert.equal(send.length, 1, 'mensagem da própria conta não dispara');
      assert.equal(send[0].json.recipient_id, 'x9');
    });

    it('pausar e excluir; editor e produtora não mexem', async () => {
      assert.equal((await as.prod.act(`/social/automacoes/${rule.id}/pausar`, {}, { from: '/social/automacoes' })).status, 403);
      await as.gestao.act(`/social/automacoes/${rule.id}/pausar`, {}, { from: `/social/automacoes/${rule.id}` });
      assert.equal((await h.db.query('SELECT active FROM social_rules WHERE id=$1', [rule.id])).rows[0].active, false);
      await as.gestao.act(`/social/automacoes/${rule.id}/excluir`, {}, { from: `/social/automacoes/${rule.id}` });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM social_events WHERE rule_id=$1', [rule.id])).rows[0].n, 0);
    });
  });

  describe('post da produtora passa pela revisão da gestão', () => {
    let pubId;
    it('produtora pede: vai para revisão (nada é enviado), avisa a gestão e já reserva o conteúdo', async () => {
      const page = (await as.prod.get('/social/novo?tipo=imagem')).text;
      assert.match(page, /Enviar para revisão/);
      assert.doesNotMatch(page, /name="confirmar"/, 'produtora não confirma envio às redes');
      const before = calls((c) => c.method === 'POST').length;
      const when = new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 16);
      const r = await as.prod.act('/social/publicar', { tipo: 'imagem', cover_ids: String(quote.id), platforms: 'instagram', title: 'Frase', description: 'Uma frase da conversa.', agendar: when }, { from: '/social/novo' });
      pubId = Number(r.location.split('/').pop());
      const pub = (await h.db.query('SELECT * FROM episode_publications WHERE id=$1', [pubId])).rows[0];
      assert.equal(pub.status, 'revisao');
      assert.equal(calls((c) => c.method === 'POST').length, before, 'nada vai para o Upload-Post');
      const { rows: n } = await h.db.query("SELECT n.title FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'gestao' AND n.title LIKE 'Post para aprovar%'");
      assert.equal(n.length, 1);
      assert.doesNotMatch((await as.gestao.get('/social/novo?tipo=imagem')).text, new RegExp(`/capas/${quote.id}/imagem`), 'em revisão já reserva o conteúdo');
      assert.match((await as.gestao.get('/social/publicacoes')).text, /1<\/strong> post espera a sua aprovação/);
      assert.match((await as.gestao.get('/')).text, /title="Posts esperando sua aprovação">1</, 'contador no menu da gestão');
      assert.equal((await as.prod.act(`/social/publicacoes/${pubId}/aprovar`, {}, { from: `/social/publicacoes/${pubId}` })).status, 403, 'produtora não aprova');
    });

    it('gestão devolve com nota; quem pediu ajusta e reenvia; gestão aprova e o post agenda', async () => {
      assert.match((await as.gestao.act(`/social/publicacoes/${pubId}/recusar`, { note: '' }, { from: `/social/publicacoes/${pubId}` })).location, new RegExp(`/social/publicacoes/${pubId}`));
      assert.equal((await h.db.query('SELECT status FROM episode_publications WHERE id=$1', [pubId])).rows[0].status, 'revisao', 'devolver exige nota');
      await as.gestao.act(`/social/publicacoes/${pubId}/recusar`, { note: 'Troque a legenda: cite o nome da convidada.' }, { from: `/social/publicacoes/${pubId}` });
      let pub = (await h.db.query('SELECT * FROM episode_publications WHERE id=$1', [pubId])).rows[0];
      assert.equal(pub.status, 'recusado');
      assert.match((await as.prod.get(`/social/publicacoes/${pubId}`)).text, /cite o nome da convidada/);
      assert.ok((await h.db.query("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'produtora' AND n.title LIKE 'Post devolvido%'")).rowCount);
      assert.equal((await as.editor.act(`/social/publicacoes/${pubId}`, { title: 'x' }, { from: '/' })).status, 403);
      await as.prod.act(`/social/publicacoes/${pubId}`, { title: 'Frase', description: 'Uma frase da Dra. Social.', reenviar: '1', agendar: new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 16) }, { from: `/social/publicacoes/${pubId}` });
      pub = (await h.db.query('SELECT * FROM episode_publications WHERE id=$1', [pubId])).rows[0];
      assert.equal(pub.status, 'revisao');
      assert.equal(pub.description, 'Uma frase da Dra. Social.');
      await as.gestao.act(`/social/publicacoes/${pubId}/aprovar`, {}, { from: `/social/publicacoes/${pubId}` });
      pub = (await h.db.query('SELECT * FROM episode_publications WHERE id=$1', [pubId])).rows[0];
      assert.equal(pub.status, 'agendado', 'horário no futuro: aprovado vira agendado');
      assert.ok(pub.reviewed_by);
      const second = await as.gestao.act(`/social/publicacoes/${pubId}/aprovar`, {}, { from: `/social/publicacoes/${pubId}` });
      assert.equal(second.status, 302, 'segundo clique não publica de novo');
      assert.ok((await h.db.query("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'produtora' AND n.title LIKE 'Post aprovado%'")).rowCount);
    });

    it('pedido sem horário: aprovado sai na hora; quem pediu pode retirar o pedido antes', async () => {
      const r = await as.prod.act('/social/publicar', { tipo: 'story', cover_ids: String(story.id), platforms: 'instagram' }, { from: '/social/novo' });
      const id = Number(r.location.split('/').pop());
      await as.prod.act(`/social/publicacoes/${id}/cancelar`, {}, { from: `/social/publicacoes/${id}` });
      assert.equal((await h.db.query('SELECT 1 FROM episode_publications WHERE id=$1', [id])).rowCount, 0, 'retirado');
      const r2 = await as.prod.act('/social/publicar', { tipo: 'story', cover_ids: String(story.id), platforms: 'instagram' }, { from: '/social/novo' });
      const id2 = Number(r2.location.split('/').pop());
      await as.gestao.act(`/social/publicacoes/${id2}/aprovar`, {}, { from: `/social/publicacoes/${id2}` });
      assert.equal((await h.db.query('SELECT status FROM episode_publications WHERE id=$1', [id2])).rows[0].status, 'simulado', 'saiu na hora (modo de teste)');
    });
  });

  it('unidade: palavra-chave ignora caixa e acento; similaridade de títulos', () => {
    assert.ok(social.has('Quero o LÍNK', ['link']));
    assert.ok(!social.has('nada a ver', ['link']));
    assert.ok(social.has('qualquer coisa', []));
    assert.ok(social.similar('Gestão é cuidado com o paciente', 'Gestão é cuidado com paciente') >= 0.6);
    assert.ok(social.similar('Cinco erros de quem abre clínica', 'Enquete sobre precificação') < 0.2);
    assert.throws(() => up.editPost({ platform: 'instagram', postId: '1' }), /não permite editar/);
  });
});
