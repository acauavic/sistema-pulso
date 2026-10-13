const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./helpers');
const L = require('../src/services/platformLimits');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('limites das plataformas', () => {
  it('YouTube: título até 100 caracteres, descrição até 5000 bytes (acentos contam 2), sem < >', () => {
    assert.ok(L.checkYoutubeTitle('x'.repeat(100)).ok);
    assert.equal(L.checkYoutubeTitle('x'.repeat(101)).ok, false);
    assert.equal(L.checkYoutubeTitle('').ok, false);
    assert.equal(L.checkYoutubeTitle('Título <b>').ok, false);
    assert.equal(L.checkYoutubeTitle('x'.repeat(80)).warnings.length, 1, 'acima de 70 avisa que pode ser cortado');
    assert.ok(L.checkYoutubeDescription('a'.repeat(5000)).ok);
    assert.equal(L.checkYoutubeDescription('é'.repeat(2501)).ok, false, '2501 letras com acento passam de 5000 bytes');
    assert.equal(L.checkYoutubeDescription('é'.repeat(2500)).ok, true);
    assert.equal(L.checkYoutubeDescription('a > b').ok, false);
  });

  it('Spotify, Instagram e TikTok', () => {
    assert.equal(L.checkSpotifyTitle('x'.repeat(101)).ok, false);
    assert.equal(L.checkSpotifyDescription('x'.repeat(3501)).ok, false);
    assert.ok(L.checkInstagramCaption('x'.repeat(2200)).ok);
    assert.equal(L.checkInstagramCaption('x'.repeat(2201)).ok, false);
    assert.equal(L.checkInstagramCaption(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')).ok, false, 'mais de 30 hashtags');
    assert.equal(L.checkTiktokCaption('x'.repeat(2201)).ok, false);
    assert.deepEqual(L.hashtagsIn('Oi #saúde e #negócios_2026, mas não a#b'), ['#saúde', '#negócios_2026']);
  });

  it('fitWords corta em palavra inteira e não deixa artigo, preposição ou pontuação pendurados', () => {
    const t = L.fitWords('Como a governança e a cultura de uma empresa mudam o resultado de todo o negócio', 60);
    assert.ok(t.length <= 60);
    assert.doesNotMatch(t, /\s(o|a|e|de|da|do|que|para|com|uma?)$/i);
    assert.doesNotMatch(t, /[,;:\-–—]$/);
    assert.equal(L.fitWords('curto', 60), 'curto');
    assert.equal(L.fitWords('Dia 30 de maio de 2031 é o prazo, de acordo com a nova', 40), 'Dia 30 de maio de 2031 é o prazo');
    for (const max of [20, 33, 47, 70, 100]) {
      const s = L.fitWords('Governança, sucessão e cultura: o que muda quando o fundador define a data da própria saída do cargo de CEO', max);
      assert.ok(s.length <= max, `${max}: ${s}`);
      assert.ok(!s.endsWith(' '));
    }
  });

  it('fitBytes respeita UTF-8 e corta em limite de parágrafo ou frase', () => {
    const txt = Array.from({ length: 200 }, (_, i) => `Parágrafo número ${i} com acentuação é ção.`).join('\n\n');
    const out = L.fitBytes(txt, 1000);
    assert.ok(L.utf8(out) <= 1000);
    assert.match(out, /\.$/, 'termina em frase completa');
  });

  it('aspas, parênteses e emoji soltos são tratados', () => {
    assert.equal(L.balanceQuotes('Disse "olá'), 'Disse olá');
    assert.equal(L.balanceQuotes('Disse "olá" a todos'), 'Disse "olá" a todos');
    assert.equal(L.balanceQuotes('Quem é (de verdade'), 'Quem é de verdade');
    assert.equal(L.stripAngles('a<b>c'), 'abc');
  });

  it('texto da thumbnail: quebra em até 2 linhas equilibradas, nunca parte palavra, e avisa quando fica grande', () => {
    assert.deepEqual(L.thumbnailLines('Sem ego, sem vaidade').lines, ['Sem ego,', 'sem vaidade']);
    assert.deepEqual(L.thumbnailLines('Prazo').lines, ['Prazo']);
    assert.equal(L.thumbnailLines('Prazo para sair').ok, true);
    const long = L.thumbnailLines('Governança corporativa e sucessão empresarial no Brasil');
    assert.equal(long.ok, false);
    assert.ok(long.issues.some((i) => /palavras/.test(i)));
    assert.equal(L.thumbnailLines('Supercalifragilisticoexpialidoso agora').ok, false, 'palavra gigante');
    assert.equal(L.thumbnailLines('').ok, false);
    for (const t of ['Eu tenho prazo', 'Novo CEO em 2031', 'Sem ego, sem vaidade', 'Cultura de dono']) {
      const r = L.thumbnailLines(t);
      assert.equal(r.lines.join(' '), t, 'as linhas juntas voltam ao texto original');
    }
  });

  it('tags do YouTube somam até 500 caracteres, sem repetir e sem #', () => {
    const tags = L.fitTags(['Saúde', '#saúde', 'governança corporativa', 'x'.repeat(70), ...Array.from({ length: 80 }, (_, i) => `palavra-chave ${i}`)]);
    assert.equal(tags[0], 'Saúde');
    assert.equal(tags.filter((t) => t.toLowerCase() === 'saúde').length, 1);
    assert.ok(!tags.some((t) => t.length > 60));
    assert.ok(tags.join(',').length <= 500);
  });

  it('capítulos: primeiro em 0:00, ordem, ≥3, ≥10 s entre eles, título curto, dentro da duração', () => {
    const ok = L.parseChapters('0:00 Abertura\n1:10 Governança\n2:30 Cultura', { durationMs: 300_000 });
    assert.deepEqual(ok.issues, []);
    assert.equal(ok.chapters[1].at_ms, 70_000);
    assert.match(L.parseChapters('0:05 A\n1:00 B\n2:00 C').issues.join(' '), /0:00/);
    assert.match(L.parseChapters('0:00 A\n0:05 B\n2:00 C').issues.join(' '), /10 segundos/);
    assert.match(L.parseChapters('0:00 A\n2:00 B').issues.join(' '), /ao menos 3/);
    assert.match(L.parseChapters('0:00 A\n1:00 B\n0:30 C').issues.join(' '), /ordem/);
    assert.match(L.parseChapters('0:00 A\n1:00 B\n9:00 C', { durationMs: 300_000 }).issues.join(' '), /depois do fim/);
    assert.match(L.parseChapters(`0:00 ${'x'.repeat(41)}\n1:00 B\n2:00 C`).issues.join(' '), /40 caracteres/);
    assert.equal(L.formatChapters([{ at_ms: 0, title: 'A' }, { at_ms: 3_725_000, title: 'B' }]), '0:00 A\n1:02:05 B');
  });
});

describe('sugestões da IA são validadas antes de chegar à equipe', () => {
  const fin = require('../src/services/finalization');
  const base = {
    resumo: 'Resumo', temas: ['governança'],
    titulos_youtube: [{ texto: 'Governança e sucessão com Jon Rocha', angulo: 'a' }, { texto: '"Eu tenho prazo para sair do cargo", diz Jon Rocha', angulo: 'b' }, { texto: 'Como planejar a sucessão da empresa sem vaidade?', angulo: 'c' }],
    textos_thumbnail: [{ texto: 'Sem ego, sem vaidade', angulo: 'a' }, { texto: 'Prazo para sair', angulo: 'b' }, { texto: 'Novo CEO em 2031', angulo: 'c' }],
    titulo_spotify: 'Governança e sucessão | Jon Rocha',
    abertura_youtube: 'Jon Rocha explica como planejar a sucessão.', topicos: ['Sucessão com data marcada.', '- Governança para as próximas gerações'], sobre_convidado: 'Empresário e mentor.',
    abertura_spotify: 'Uma conversa sobre sucessão.', tags: ['governança', 'sucessão', 'Governança'], hashtags: ['governança', '#sucessão', 'liderança', 'extra'],
    capitulos: [{ inicio: '0:03', titulo: 'Abertura' }, { inicio: '0:17', titulo: 'Governança e data de sucessão' }, { inicio: '0:20', titulo: 'Colado demais' }, { inicio: '0:33', titulo: 'Cultura' }, { inicio: '9:99', titulo: 'Inválido' }, { inicio: '5:00', titulo: 'Depois do fim' }],
    citacoes: [{ frase: 'Eu tenho prazo para sair da cadeira de CEO.', inicio: '0:08', quem: 'Jon' }, { frase: 'Curta', inicio: '0:10', quem: '' }],
    momentos: [{ inicio: '0:00', fim: '0:24', titulo: 'Data marcada para a saída', motivo: 'm' }, { inicio: '0:10', fim: '0:12', titulo: 'curto demais', motivo: 'm' }],
  };
  const ctx = { durationMs: 44_000, episode: { number: 1, title: 'x' }, guest: { name: 'Jonata Rocha', instagram: 'jon.divisao' }, sponsors: [{ company: 'America', website: 'https://america.com.br', landing_url: null }] };

  it('títulos: aspas balanceadas, no máximo 100, sem repetir; thumbnail em até 2 linhas', () => {
    const { suggestions: s, issues } = fin.normalizeSuggestions(base, ctx);
    assert.deepEqual(issues, []);
    assert.equal(s.youtube_titles.length, 3);
    assert.equal(s.youtube_titles[1].texto, '"Eu tenho prazo para sair do cargo", diz Jon Rocha', 'aspas que fecham são mantidas');
    assert.ok(s.youtube_titles.every((t) => t.check.ok));
    assert.deepEqual(s.thumbnail_texts[0].lines.lines, ['Sem ego,', 'sem vaidade']);
  });

  it('título longdemais é cortado em palavra inteira e continua válido', () => {
    const raw = { ...base, titulos_youtube: [{ texto: 'Governança e sucessão corporativa: como uma empresa familiar prepara a próxima geração para assumir o comando com cultura e propósito', angulo: 'a' }, ...base.titulos_youtube.slice(1)] };
    const { suggestions: s } = fin.normalizeSuggestions(raw, ctx);
    assert.ok(s.youtube_titles[0].texto.length <= 100);
    assert.ok(s.youtube_titles[0].check.ok);
    assert.doesNotMatch(s.youtube_titles[0].texto, /\s(de|da|do|e|o|a|com|para)$/i);
  });

  it('capítulos: o primeiro vira 0:00, descarta os colados (<10 s), os inválidos e os depois do fim', () => {
    const { suggestions: s } = fin.normalizeSuggestions(base, ctx);
    assert.deepEqual(s.chapters.map((c) => c.at_ms), [0, 17_000, 33_000]);
    assert.ok(s.chapters.every((c) => c.title.length < 40));
  });

  it('descrição do YouTube: estrutura nossa (abertura, tópicos, sobre, capítulos, convidado, apoio, hashtags) e dentro do limite', () => {
    const { suggestions: s } = fin.normalizeSuggestions(base, ctx);
    const d = s.youtube_description;
    assert.match(d, /^Jon Rocha explica como planejar a sucessão\.\n\nNeste episódio:\n- Sucessão com data marcada\n- Governança para as próximas gerações\n\nEmpresário e mentor\./);
    assert.match(d, /\n\nCapítulos\n0:00 Abertura\n0:17 Governança e data de sucessão\n0:33 Cultura\n\n/);
    assert.match(d, /Convidado: Jonata Rocha \(@jon\.divisao\)\nApoio: America — https:\/\/america\.com\.br/);
    assert.match(d, /\n\n#governança #sucessão #liderança$/, 'só 3 hashtags');
    assert.ok(L.checkYoutubeDescription(d).ok);
    assert.doesNotMatch(d, /[<>]/);
    assert.ok(s.tags.length === 2, 'tags repetidas saem');
  });

  it('patrocinador citado pela IA no corpo é removido (o bloco "Apoio" é nosso); emoji e < > somem', () => {
    const raw = { ...base, abertura_youtube: 'Abertura boa 🚀 com <tag>.', sobre_convidado: 'Patrocínio: America Licenciamentos\nEmpresário.', abertura_spotify: 'Apoio: America\nTexto.' };
    const { suggestions: s } = fin.normalizeSuggestions(raw, ctx);
    assert.doesNotMatch(s.youtube_description, /🚀|<|>/);
    assert.equal((s.youtube_description.match(/America/g) || []).length, 1, 'só no bloco Apoio');
    assert.equal((s.spotify_description.match(/America/g) || []).length, 1);
  });

  it('descrição enorme é cortada em limite de frase, preservando capítulos e apoio, e fica abaixo de 5000 bytes', () => {
    const huge = 'Frase longa com acentuação é ção. '.repeat(400);
    const raw = { ...base, abertura_youtube: huge, sobre_convidado: huge, abertura_spotify: huge, topicos: Array.from({ length: 8 }, (_, i) => `Tópico ${i} ${'palavra '.repeat(40)}`) };
    const { suggestions: s } = fin.normalizeSuggestions(raw, ctx);
    assert.ok(L.utf8(s.youtube_description) <= 5000);
    assert.ok(L.checkYoutubeDescription(s.youtube_description).ok);
    assert.match(s.youtube_description, /Capítulos\n0:00 Abertura/);
    assert.match(s.youtube_description, /Apoio: America/);
    assert.ok(s.spotify_description.length <= 3500);
    assert.match(s.spotify_description, /Apoio: America/);
  });

  it('citações curtas e momentos curtos demais são descartados', () => {
    const { suggestions: s } = fin.normalizeSuggestions(base, ctx);
    assert.equal(s.quotes.length, 1);
    assert.equal(s.moments.length, 1);
    assert.equal(s.moments[0].end_ms, 24_000);
  });

  it('sinaliza o que a IA não entregou (menos de 3 títulos) para pedir correção', () => {
    const { issues } = fin.normalizeSuggestions({ ...base, titulos_youtube: [base.titulos_youtube[0]] }, ctx);
    assert.match(issues.join(' '), /devolveu 1 título/);
  });

  it('nota de quadro: rosto grande, olhos abertos e sem legenda ganham; legenda e olho fechado perdem', () => {
    const good = { nota_thumbnail: 8, nitidez: 8, luz: 8, rostos: [{ x: 0.3, y: 0.1, w: 0.4, h: 0.3 }], olhos_abertos: true, texto_queimado: false };
    assert.ok(fin.scoreFrame(good) > fin.scoreFrame({ ...good, texto_queimado: true }));
    assert.ok(fin.scoreFrame(good) > fin.scoreFrame({ ...good, olhos_abertos: false }));
    assert.ok(fin.scoreFrame(good) > fin.scoreFrame({ ...good, rostos: [] }));
    assert.equal(fin.scoreFrame(null), 0);
  });
});

// Fluxo completo do trabalho em segundo plano, com FFmpeg REAL (vídeo gerado aqui) e IA/transcrição SIMULADAS.
describe('trabalho de finalização (FFmpeg real, IA simulada)', { skip: hasFfmpeg ? false : 'FFmpeg não instalado' }, () => {
  let app; let ep; let tmp; let videoBuf;
  const as = {};
  const jobs = require('../src/services/jobs');
  const finJob = require('../src/services/finalizationJob');

  // Gemini e Groq simulados (o suporte do helper cobre Groq simples; aqui precisamos do verbose e do Gemini).
  const realFetch = global.fetch;
  const geminiCalls = [];
  before(async () => {
    process.env.GEMINI_KEY = 'test-gemini';
    require('../src/config').gemini.key = 'test-gemini';
    require('../src/config').geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') {
        const form = opts.body;
        h.groqCalls.push({ model: form.get('model'), language: form.get('language'), file: form.get('file'), auth: opts.headers.Authorization, format: form.get('response_format'), gran: form.get('timestamp_granularities[]') });
        return Response.json({ text: 'Eu tenho prazo para sair do cargo. Sem ego, sem vaidade.', duration: 6, segments: [
          { start: 0, end: 3, text: ' Eu tenho prazo para sair do cargo.' }, { start: 3, end: 6, text: ' Sem ego, sem vaidade.' }] });
      }
      if (u.startsWith('https://generativelanguage.googleapis.com/')) {
        const body = JSON.parse(opts.body);
        const parts = body.contents[0].parts;
        const images = parts.filter((p) => p.inline_data).length;
        geminiCalls.push({ url: u, key: opts.headers['x-goog-api-key'], images, thinking: body.generationConfig.thinkingConfig, schemaKeys: Object.keys(body.generationConfig.responseSchema.properties) });
        let data;
        if (images) {
          data = { quadros: parts.filter((p) => p.text?.startsWith('Quadro índice')).map((p) => ({
            indice: Number(p.text.match(/índice (\d+)/)[1]), rostos: [{ x: 0.3, y: 0.1, w: 0.4, h: 0.3 }], olhos_abertos: true, expressao: 'falando', nitidez: 7, luz: 7,
            texto_queimado: false, caixas_de_texto: [], nota_thumbnail: 5 + (Number(p.text.match(/índice (\d+)/)[1]) % 4),
          })) };
        } else {
          data = {
            resumo: 'Resumo', temas: ['governança'],
            titulos_youtube: [{ texto: 'Governança e sucessão com Jonata Rocha', angulo: 'a' }, { texto: 'Eu tenho prazo para sair do cargo', angulo: 'b' }, { texto: 'Como planejar a sucessão sem vaidade?', angulo: 'c' }],
            textos_thumbnail: [{ texto: 'Sem ego, sem vaidade', angulo: 'a' }, { texto: 'Prazo para sair', angulo: 'b' }, { texto: 'Novo CEO em 2031', angulo: 'c' }],
            titulo_spotify: 'Governança e sucessão | Jonata Rocha', abertura_youtube: 'Jonata Rocha fala de sucessão com governança.', topicos: ['Sucessão com data marcada'], sobre_convidado: 'Empresário e mentor.',
            abertura_spotify: 'Uma conversa sobre sucessão.', tags: ['governança', 'sucessão'], hashtags: ['governança', 'sucessão', 'liderança'],
            capitulos: [{ inicio: '0:00', titulo: 'Abertura' }], citacoes: [{ frase: 'Sem ego, sem vaidade nunca atrapalha ninguém.', inicio: '0:03', quem: 'Jonata' }], momentos: [],
          };
        }
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: { totalTokenCount: 10 } });
      }
      return realFetch(url, opts);
    };
    // o helper já definiu global.fetch com os mocks de B2/Groq: encadeia (o nosso vem na frente)
    await h.resetDb();
    app = await h.startServer();
    for (const [k, email, role] of [['gestao', 'g@t.com', 'gestao'], ['editor', 'e@t.com', 'editor_video'], ['prod', 'p@t.com', 'produtora']]) {
      await h.createUser({ name: k, email, role });
      as[k] = h.client(app.base);
      await as[k].login(email);
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
    const file = path.join(tmp, 'in.mp4');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    assert.equal(r.status, 0, String(r.stderr));
    videoBuf = fs.readFileSync(file);
    const { rows: [e] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (1, 'Conversa com Jonata Rocha', 'em_revisao') RETURNING *");
    ep = e;
    const key = 'pp/episodios/1/editado-teste.mp4';
    h.b2Store.set(key, { body: videoBuf, contentType: 'video/mp4' });
    await h.db.query("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, storage_key, status, version) VALUES ($1,'editado','v1.mp4','video/mp4',$2,$3,'pronto',1)", [ep.id, videoBuf.length, key]);
  });
  after(async () => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); await app.close(); await h.db.close(); });

  it('aprovar o vídeo enfileira a análise; o trabalho transcreve, escolhe quadros, lê os quadros e gera os textos', async () => {
    const csrf = await as.gestao.csrf('/episodios');
    const res = await as.gestao.post(`/episodios/${ep.id}/etapa`, { to: 'em_finalizacao' }, { headers: { accept: 'application/json', 'x-csrf-token': csrf } });
    assert.equal(res.status, 200, res.text);
    const queued = await jobs.latest(ep.id, 'finalizacao');
    assert.equal(queued.status, 'queued');
    const again = await jobs.enqueue('finalizacao', { episodeId: ep.id });
    assert.equal(again.id, queued.id, 'não duplica o que já está na fila');

    const done = await jobs.runNext();
    assert.equal(done.status, 'done', done.error);
    assert.equal(done.progress, 100);
    assert.equal(done.result.segments, 2);
    assert.ok(done.result.frames >= 8);

    const { rows: [tr] } = await h.db.query('SELECT * FROM episode_transcripts WHERE episode_id=$1', [ep.id]);
    assert.match(tr.text, /Sem ego, sem vaidade/);
    assert.equal(tr.segments[0].start_ms, 0);
    assert.equal(tr.segments[1].start_ms, 3000);
    assert.ok(h.groqCalls.some((c) => c.format === 'verbose_json' && c.gran === 'segment' && c.model === 'whisper-large-v3' && c.language === 'pt'));
    assert.ok(h.groqCalls.some((c) => c.file.type === 'audio/ogg'), 'áudio comprimido em Opus/Ogg');
    assert.ok(geminiCalls.every((c) => c.key === 'test-gemini'));
    assert.ok(geminiCalls.some((c) => c.images > 0 && c.thinking?.thinkingLevel === 'low'), 'leitura de imagem usa raciocínio baixo (rápido)');
    assert.ok(geminiCalls.some((c) => c.images === 0 && c.schemaKeys.includes('titulos_youtube')));

    const { rows: frames } = await h.db.query('SELECT * FROM episode_frames WHERE episode_id=$1 ORDER BY at_ms', [ep.id]);
    assert.ok(frames.length >= 8);
    assert.ok(frames.every((f) => h.b2Store.has(f.storage_key) && f.storage_key.startsWith(`pp/episodios/${ep.id}/quadros/`)));
    assert.ok(frames.every((f) => f.width === 360 && f.height === 640), 'quadros na resolução do vídeo');
    const jpg = h.b2Store.get(frames[0].storage_key).body;
    assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8, 'JPEG de verdade');
    assert.ok(frames.every((f) => f.analysis.rostos.length === 1 && f.score > 0));

    const { rows: [m] } = await h.db.query('SELECT * FROM episode_metadata WHERE episode_id=$1', [ep.id]);
    assert.equal(m.yt_title, 'Governança e sucessão com Jonata Rocha');
    assert.equal(m.thumb_text, 'Sem ego, sem vaidade');
    assert.equal(m.sp_title, 'Governança e sucessão | Jonata Rocha');
    assert.match(m.yt_description, /Neste episódio:\n- Sucessão com data marcada/);
    assert.equal(m.ai_model, 'gemini-3.8-flash');
    const best = frames.reduce((a, b) => (b.score > a.score ? b : a));
    assert.equal(m.thumb_frame_id, best.id, 'o quadro de maior nota vira o padrão');
    assert.equal((await h.db.query("SELECT count(*)::int n FROM episode_events WHERE episode_id=$1 AND type='ia'", [ep.id])).rows[0].n, 2);
    const { rows: covs } = await h.db.query('SELECT kind, storage_key, width, height, lint FROM episode_covers WHERE episode_id=$1', [ep.id]);
    assert.equal(covs.filter((c) => c.kind === 'youtube_thumb').length, 3, 'o trabalho já monta 3 opções de thumbnail');
    assert.ok(covs.filter((c) => c.kind === 'youtube_thumb').every((c) => c.width === 1280 && c.height === 720 && c.lint.issues.length === 0 && h.b2Store.has(c.storage_key)));
    assert.ok(covs.some((c) => c.kind === 'post_quote'), 'e o post com a melhor frase');
  });

  it('a página mostra o status, as sugestões com contadores e os quadros com nota', async () => {
    const page = (await as.gestao.get(`/episodios/${ep.id}`)).text;
    assert.match(page, /Análise por IA/);
    assert.match(page, /pronta/);
    assert.match(page, /Governança e sucessão com Jonata Rocha/);
    assert.match(page, /data-counter-for="yt_title"/);
    assert.match(page, /Sem ego, \/ sem vaidade/);
    assert.match(page, new RegExp(`/episodios/${ep.id}/quadros/\\d+`));
    assert.match(page, /1 rosto\(s\)/);
    assert.match(page, /Transcrição: 2 trechos/);
    const frame = (await h.db.query('SELECT id FROM episode_frames WHERE episode_id=$1 LIMIT 1', [ep.id])).rows[0];
    const redirect = await as.editor.get(`/episodios/${ep.id}/quadros/${frame.id}`);
    assert.equal(redirect.status, 302);
    assert.match(redirect.location, /X-Amz-Signature=/);
    assert.equal((await as.editor.get(`/episodios/${ep.id}/quadros/999999`)).status, 404);
  });

  it('salvar os textos valida os limites (nada é salvo se algo passar) e não sobrescreve o que a equipe editou ao reanalisar', async () => {
    const save = (fields) => as.gestao.act(`/episodios/${ep.id}/metadados`, fields, { from: `/episodios/${ep.id}` });
    const ok = { yt_title: 'Título editado à mão', yt_description: 'Descrição editada', yt_tags: 'a, b', sp_title: 'Spotify editado', sp_description: 'Desc', thumb_text: 'Prazo para sair', chapters: '' }; // o vídeo de teste tem 6 s: capítulo válido não cabe
    const bad = (extra) => save({ ...ok, ...extra });
    const flash = async () => (await as.gestao.get(`/episodios/${ep.id}`)).text;
    await bad({ yt_title: 'x'.repeat(101) }); assert.match(await flash(), /Nada foi salvo: O título passa de 100/);
    await bad({ yt_description: 'é'.repeat(2501) }); assert.match(await flash(), /passa de 5000 bytes/);
    await bad({ yt_description: 'a < b' }); assert.match(await flash(), /sinais &lt; ou &gt;/);
    await bad({ yt_tags: 'x'.repeat(501) }); assert.match(await flash(), /tags passam de 500/);
    await bad({ sp_description: 'x'.repeat(3501) }); assert.match(await flash(), /descrição do Spotify passa de 3500/);
    await bad({ chapters: '0:05 A\n0:10 B' }); assert.match(await flash(), /Capítulos:/);
    await bad({ thumb_text: 'x'.repeat(41) }); assert.match(await flash(), /thumbnail passa de 40/);
    assert.equal((await h.db.query('SELECT yt_title FROM episode_metadata WHERE episode_id=$1', [ep.id])).rows[0].yt_title, 'Governança e sucessão com Jonata Rocha', 'nada mudou');
    assert.equal((await as.editor.act(`/episodios/${ep.id}/metadados`, ok, { from: `/episodios/${ep.id}` })).status, 403, 'editor não altera textos de publicação');

    await save(ok);
    const { rows: [m] } = await h.db.query('SELECT yt_title, chapters FROM episode_metadata WHERE episode_id=$1', [ep.id]);
    assert.equal(m.yt_title, 'Título editado à mão');
    assert.equal(m.chapters, null);
    const tooLate = await save({ ...ok, chapters: '0:00 A\n0:20 B\n0:40 C' }); // depois do fim do vídeo (6 s)
    assert.match((await as.gestao.get(`/episodios/${ep.id}`)).text, /depois do fim do vídeo/);
    void tooLate;

    await as.gestao.act(`/episodios/${ep.id}/ia/gerar`, {}, { from: `/episodios/${ep.id}` });
    assert.equal((await jobs.runNext()).status, 'done');
    const { rows: [after] } = await h.db.query('SELECT yt_title, sp_title, suggestions FROM episode_metadata WHERE episode_id=$1', [ep.id]);
    assert.equal(after.yt_title, 'Título editado à mão', 'o que a equipe escreveu não é sobrescrito');
    assert.equal(after.suggestions.youtube_titles[0].texto, 'Governança e sucessão com Jonata Rocha', 'mas as sugestões novas ficam disponíveis');
  });

  it('falhas viram erro legível no trabalho; sem vídeo editado ou sem chaves, nem entra na fila', async () => {
    const { rows: [e2] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (2, 'Sem vídeo', 'em_finalizacao') RETURNING id");
    const csrf = await as.gestao.csrf('/episodios');
    await as.gestao.post(`/episodios/${e2.id}/ia/gerar`, { _csrf: csrf });
    assert.equal(await jobs.latest(e2.id, 'finalizacao'), null, 'sem vídeo editado não enfileira');
    assert.equal((await as.editor.post(`/episodios/${ep.id}/ia/gerar`, { _csrf: await as.editor.csrf('/episodios') })).status, 403);
    const job = await jobs.enqueue('finalizacao', { episodeId: e2.id });
    const failed = await jobs.runNext();
    assert.equal(failed.id, job.id);
    assert.equal(failed.status, 'error');
    assert.match(failed.error, /Não há vídeo editado/);
    assert.equal((await as.gestao.get(`/episodios/${e2.id}/ia/status`)).status, 200);
    const status = JSON.parse((await as.gestao.get(`/episodios/${e2.id}/ia/status`)).text);
    assert.equal(status.job.status, 'error');
    void finJob;
  });

  it('excluir o episódio apaga também os quadros do bucket', async () => {
    const { rows: frames } = await h.db.query('SELECT storage_key FROM episode_frames WHERE episode_id=$1', [ep.id]);
    assert.ok(frames.length && frames.every((f) => h.b2Store.has(f.storage_key)));
    await as.gestao.act(`/episodios/${ep.id}/excluir`, {}, { from: '/episodios' });
    assert.ok(frames.every((f) => !h.b2Store.has(f.storage_key)));
  });
});
