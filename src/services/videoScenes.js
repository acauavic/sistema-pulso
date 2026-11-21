// Cenas dos vídeos do convidado (Guia de peças, seção 07), 1080×1920 a 30 quadros por segundo. Cada cena devolve frame(t): o
// "spec" do quadro no instante t, desenhado pelo mesmo motor das capas (public/design/engine.js). Sem trilha: ela entra na hora
// de postar.
// - story (VD-A, 11 s, para quem já segue): intro com a linha de pulso, a foto revela, nome e título, chamada para o link.
// - teaser (VD-B, 15 s, público frio): abre com o gancho já no primeiro quadro, diz quem é, a frase literal com a legenda
//   entrando palavra a palavra, e onde assistir. O número do episódio só aparece no fim.
// Movimento: entradas de 0,6 s com ease-out cúbico subindo 40 px; linha de pulso e máscaras com ease-in-out.
const E = require('../public/design/engine');
const M = require('../public/design/models');

const { BRAND, FONTS } = E;
const { text, mono, logo, rect, gradient, tarja, photoLayer, stack, heightOf, fitted, boxOf, wordmarkWidth, tarjaFit, epLabel, upper, MONO_LH, SHADE } = M.parts;
const W = 1080; const H = 1920; const FPS = 30;
const INK = BRAND.black;

const c01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;
// Entrada padrão do guia: 0,6 s, ease-out cúbico, subindo 40 px. Saída: some em `dur`.
const enter = (t, t0, dur = 0.6) => { const p = easeOut(c01((t - t0) / dur)); return { alpha: p, dy: (1 - p) * 40 }; };
const leave = (t, t0, dur = 0.3) => 1 - c01((t - t0) / dur);
// Aplica opacidade e deslocamento a uma camada (ou a várias). Camada com alpha 0 não é desenhada.
const put = (layers, alpha, dy = 0) => [].concat(layers).filter(Boolean).map((l) => ({ ...l, alpha, y: l.y + dy }));
const inOut = (layers, t, t0, t1 = Infinity, out = 0.3) => { const e = enter(t, t0); return put(layers, Math.min(e.alpha, leave(t, t1, out)), e.dy); };
const centered = (id, str, y, size, o = {}) => text(id, str, o.x ?? 0, y, o.w ?? W, size, { ...o, align: 'center' });
const base = (layers) => ({ format: 'reel_cover', width: W, height: H, bg: { kind: 'solid', color: INK }, scrims: [], layers: layers.flat().filter(Boolean) });

// ---------------------------------------------------------------- VD-A · Story de lançamento (11 s)
// d: { guest, ep, title }
function story(ctx, d, photo) {
  const c = M.crop(photo, 920, 820, 460, 330, 360);
  const ph = photoLayer(photo, c, 80, 300, 920, 820, { bgColor: BRAND.graphite });
  const lwBig = wordmarkWidth(ctx, 220);
  const name = text('nome', d.guest, 80, 1160, 920, 52, { font: FONTS.voice, lh: 1, tracking: -0.005, color: BRAND.lime, role: 'meta' });
  const title = fitted(ctx, text('texto', d.title, 80, 1160 + 52 + 18, 920, 76, { tracking: -0.045, lh: 0.98, maxLines: 5 }), 76, 52, 4);
  const ep = epLabel(ctx, d.ep, W - 80, 140, 84, BRAND.white, 34);
  const noAr = [rect('noArPonto', 116, 300 + 820 - 34 - 30 * MONO_LH + (30 * MONO_LH - 16) / 2, 16, 16, BRAND.lime, 8), mono('noAr', 'NOVO EPISÓDIO NO AR', 146, 300 + 820 - 34 - 30 * MONO_LH, 800, 30, { lh: MONO_LH })];
  const cta = centered('chamada', 'TOQUE NO LINK E OUÇA AGORA', 1500, 28, { font: FONTS.mono, tracking: 0.14, lh: MONO_LH, color: BRAND.silver, role: 'meta' });
  const PULSE = [[0, 100], [430, 100], [462, 100], [494, 20], [534, 180], [562, 50], [582, 100], [1080, 100]];

  function frame(t) {
    const k = easeInOut(c01((t - 1.6) / 0.8)); // o logo sai do centro e sobe para o canto
    const intro = enter(t, 0.5);
    const size = lerp(220, 84, k);
    const reveal = easeInOut(c01((t - 1.8) / 0.9));
    const breathe = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((t - 7) * Math.PI * 1.4)); // a área da figurinha respira
    return base([
      put({ id: 'pulso', type: 'pulse', x: 0, y: 860, w: W, pts: PULSE, color: BRAND.lime, width: 6, progress: easeInOut(c01(t / 1.0)) }, t < 1.6 ? 1 : leave(t, 1.6, 0.4)),
      t >= 1.8 ? [{ ...ph.layer, reveal }, put(gradient('fotoBase', 80, 300, 920, 820, 'up', [[0, SHADE(0.75)], [0.45, SHADE(0)]]), reveal)] : [],
      put(logo(lerp((W - lwBig) / 2, 80, k), lerp(600, 140, k), size), intro.alpha, t < 1.6 ? intro.dy : 0),
      inOut(ep, t, 2.4, 7.0),
      inOut(noAr, t, 2.8, 4.0),
      inOut(name, t, 4.0), inOut(title, t, 4.2),
      inOut(cta, t, 7.0),
      put(rect('figurinha', 260, 1500 + 28 * MONO_LH + 22, 560, 132, 'rgba(200,255,66,0.08)', 66), enter(t, 7.2).alpha * breathe).map((l) => ({ ...l, stroke: BRAND.lime, strokeWidth: 3, dash: [18, 12] })),
      put(rect('fim', 0, 0, W, H, INK), c01((t - 10.5) / 0.5)), // fade para preto no último meio segundo
    ]);
  }
  return { duration: 11, fps: FPS, frame, zoom: c ? Math.round(c.zoom * 10) / 10 : null, soft: Boolean(c && c.soft), posterAt: 6 };
}

// ---------------------------------------------------------------- VD-B · Teaser para público frio (15 s)
// d: { pre, hl, post, guest, tag, quote, ep }. words: [{ at }] com o instante (em segundos do vídeo) em que cada palavra da frase é dita.
function teaser(ctx, d, photo, words = []) {
  const c = M.crop(photo, W, H, 540, 700, 460);
  const ph = photoLayer(photo, c, 0, 0, W, H);
  const pad = { t: 12, r: 32, b: 24, l: 20 };
  const hook = [
    M.tidy(d.pre) ? text('texto', d.pre, 80, 0, 920, 104, { tracking: -0.06, lh: 0.9, maxLines: 2 }) : null,
    tarja(d.hl, 80, 0, tarjaFit(ctx, d.hl, 140, 96, 920, pad), { pad }),
    M.tidy(d.post) ? text('fecho', d.post, 80, 0, 920, 104, { tracking: -0.06, lh: 0.9, maxLines: 2 }) : null,
  ].filter(Boolean);
  stack(ctx, hook, 1220, 16);
  const who = [
    fitted(ctx, text('nome', d.guest, 80, 0, 920, 130, { tracking: -0.06, lh: 0.88, maxLines: 2 }), 130, 92, 2),
    M.tidy(d.tag) ? mono('rotulo', upper(d.tag), 80, 0, 920, 34, { tracking: 0.12, lh: 1.35 }) : null,
  ].filter(Boolean);
  stack(ctx, who, 1260, 22);
  const quote = fitted(ctx, text('frase', d.quote, 80, 1220, 920, 96, { font: FONTS.voice, tracking: -0.005, lh: 1, maxLines: 5 }), 96, 68, 4);
  const total = M.wordsOf(d.quote).length;
  const at = (i) => (words[i] ? words[i].at : 5.2 + i * 0.36); // sem o tempo de cada palavra: uma a cada 0,36 s
  const aspas = text('aspas', '“', 70, 1000, 320, 320, { font: FONTS.voice, tracking: 0, lh: 1, color: BRAND.lime, role: 'deco' });
  const lwEnd = wordmarkWidth(ctx, 200);
  const where = centered('onde', 'Episódio completo no YouTube e no Spotify', 880, 56, { x: 120, w: 840, tracking: -0.04, lh: 1.05 });
  const link = centered('link', 'LINK NA BIO', 1080 + (120 - 32 * MONO_LH) / 2, 32, { x: 260, w: 560, font: FONTS.mono, tracking: 0.12, lh: MONO_LH, color: INK, role: 'meta' });
  const epEnd = centered('ep', `EP ${M.ep3(d.ep)}`, 1250, 28, { font: FONTS.mono, tracking: 0.14, lh: MONO_LH, color: BRAND.steel, role: 'meta' });

  function frame(t) {
    const dark = c01((t - 5) / 0.5); // a foto escurece para a frase
    const hidden = Array.from({ length: total }, (_, i) => i).filter((i) => t < at(i)); // palavras que ainda não foram ditas
    const end = c01((t - 11) / 0.3);
    return base([
      { ...ph.layer, zoom: lerp(1.08, 1, c01(t / 5)), filter: dark > 0.5 ? { saturate: 0.6, contrast: 1.06 } : { saturate: 0.85, contrast: 1.06 } },
      put(rect('escuro', 0, 0, W, H, INK), dark * 0.68),
      put(gradient('g1', 0, 0, W, H, 'down', [[0, SHADE(0.6)], [0.2, SHADE(0)], [0.48, SHADE(0)], [0.62, SHADE(0.9)], [0.8, INK], [1, INK]]), leave(t, 2.0, 0.4)),
      put(gradient('g2', 0, 0, W, H, 'down', [[0, SHADE(0.9)], [0.17, SHADE(0.85)], [0.27, SHADE(0)], [0.5, SHADE(0)], [0.64, SHADE(0.9)], [0.8, INK], [1, INK]]), Math.min(c01((t - 2) / 0.4), leave(t, 5.0, 0.5))),
      put(hook, leave(t, 2.0, 0.3)), // o gancho já está no primeiro quadro: sem logo, sem vinheta
      inOut(logo(80, 270, 72), t, 2.1, 5.0),
      inOut(who[0], t, 2.2, 5.0), who[1] ? inOut(who[1], t, 2.4, 5.0) : [],
      inOut(aspas, t, 5.1, 10.7),
      // sempre palavra por palavra (mesmo com todas à vista): o texto não treme quando a última entra
      put({ ...quote, marks: { words: hidden.length ? hidden : [-1], color: 'rgba(0,0,0,0)' } }, Math.min(c01((t - 5.1) / 0.3), leave(t, 10.7, 0.3))),
      put(rect('fundoFim', 0, 0, W, H, INK), end),
      inOut(logo((W - lwEnd) / 2, 620, 200), t, 11.1),
      inOut(where, t, 11.3),
      inOut(rect('botao', 260, 1080, 560, 120, BRAND.lime, 60), t, 11.5), inOut(link, t, 11.5),
      inOut(epEnd, t, 11.7),
    ]);
  }
  return { duration: 15, fps: FPS, frame, zoom: c ? Math.round(c.zoom * 10) / 10 : null, soft: Boolean(c && c.soft), posterAt: 0.5 };
}

module.exports = { W, H, FPS, story, teaser, enter, leave, easeOut, easeInOut };
