// Identidade do painel (Health Scale Studio): tokens, fontes, ícones e marca. O que é do Pulso continua do Pulso.
// A primeira parte só lê arquivos (não precisa de banco); a parte com servidor fica no fim.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const css = read('src/public/app.css');
// Bloco de variáveis de um tema: `:root { … }` (escuro) ou `:root[data-theme="light"] { … }`.
function tokens(theme) {
  const start = theme === 'light' ? css.indexOf(':root[data-theme="light"] {') : css.indexOf(':root {');
  assert.ok(start >= 0, `bloco de tokens do tema ${theme}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('identidade: tokens do painel', () => {
  const dark = tokens('dark');
  const light = { ...dark, ...tokens('light') };

  it('escuro usa a paleta do estudo da Health Scale', () => {
    assert.equal(dark.bg, '#0E0F0D'); assert.equal(dark.surface, '#16180F'); assert.equal(dark.line, '#262A22');
    assert.equal(dark.text, '#F4F4F0'); assert.equal(dark['text-2'], '#A8ABA1'); assert.equal(dark.muted, '#8A8D83');
    assert.equal(dark.action, '#9EDD55'); assert.equal(dark['on-action'], '#0E0F0D');
  });

  it('claro: fundo, texto e botão principal preto', () => {
    assert.equal(light.bg, '#F4F4F0'); assert.equal(light.text, '#101210'); assert.equal(light['text-2'], '#54574F');
    assert.equal(light['line-strong'], '#C9C9C1'); assert.equal(light.action, '#101210');
  });

  for (const [name, t] of [['escuro', dark], ['claro', light]]) {
    it(`${name}: todo par de texto e fundo passa em 4,5:1`, () => {
      const pairs = [['text', 'bg'], ['text', 'surface'], ['text', 'raised'], ['text-2', 'surface'], ['text-2', 'raised'],
        ['muted', 'bg'], ['muted', 'surface'], ['muted', 'raised'], ['on-action', 'action'], ['ok', 'ok-bg'], ['warn', 'warn-bg'], ['bad', 'bad-bg'],
        ...['pauta', 'agendado', 'gravado', 'edicao', 'publicado', 'cancelado'].map((s) => [`st-${s}-fg`, `st-${s}-bg`])];
      for (const [fg, bg] of pairs) {
        assert.match(t[fg] || '', /^#[0-9A-F]{6}$/i, `--${fg} é uma cor`); assert.match(t[bg] || '', /^#[0-9A-F]{6}$/i, `--${bg} é uma cor`);
        const c = contrast(t[fg], t[bg]);
        assert.ok(c >= 4.5, `--${fg} sobre --${bg} no ${name}: ${c.toFixed(2)}:1`);
      }
    });
  }

  it('nada da marca do Pulso sobra na folha do painel', () => {
    for (const gone of ['--lime', 'var(--black)', 'var(--white)', '--plum', 'C8FF42', 'c8ff42', 'rgba(200, 255, 66', '#0A0A0A', '#FAFAFA'])
      assert.ok(!css.includes(gone), `app.css ainda tem ${gone}`);
  });

  it('Archivo assume título e texto; as fontes das capas do Pulso continuam disponíveis', () => {
    assert.match(dark['f-display'], /^"Archivo"/); assert.match(dark['f-body'], /^"Archivo"/);
    assert.match(css, /@font-face \{ font-family: "Archivo"; font-weight: 400 800;[^}]*archivo-latin-wght-normal\.woff2/);
    assert.ok(fs.statSync(path.join(root, 'src/public/fonts/archivo-latin-wght-normal.woff2')).size > 20000);
    assert.ok(exists('src/public/fonts/LICENSE-Archivo.txt'));
    assert.match(css, /@font-face \{ font-family: "Space Grotesk"/, 'o motor das capas desenha com Space Grotesk dentro do painel');
    assert.match(css, /@font-face \{ font-family: "Inter"/);
  });
});

describe('identidade: ícones do painel e ícones do Pulso', () => {
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`])).filter((f) => !path.basename(f).startsWith('._'));

  it('favicon do painel é o monograma "St" em contornos; o do Pulso fica guardado na pasta dele', () => {
    const fav = read('src/public/favicon.svg');
    assert.match(fav, /#0E0F0D/); assert.match(fav, /#9EDD55/); assert.match(fav, /<path/);
    assert.doesNotMatch(fav, /<text|C8FF42/i, 'ícone não carrega fonte: as letras são contornos');
    assert.match(read('src/public/brand/pulso/favicon.svg'), /C8FF42/i);
    for (const f of ['favicon.ico', 'apple-touch-icon.png']) assert.ok(exists(`src/public/brand/pulso/${f}`), f);
    for (const f of ['health-scale-logo.png', 'signal-bg.svg']) assert.ok(exists(`src/public/brand/studio/${f}`), f);
  });

  it('manifesto do app: Health Scale Studio, fundo da paleta nova', () => {
    const mf = JSON.parse(read('src/public/manifest.webmanifest'));
    assert.equal(mf.name, 'Health Scale Studio'); assert.equal(mf.short_name, 'Studio');
    assert.equal(mf.theme_color, '#0E0F0D'); assert.equal(mf.background_color, '#0E0F0D');
    assert.doesNotMatch(JSON.stringify(mf), /Pulso Gestão/);
  });

  it('service worker guarda a fonte nova e troca o nome do cache', () => {
    const sw = read('src/public/sw.js');
    assert.match(sw, /\/static\/fonts\/archivo-latin-wght-normal\.woff2/);
    assert.match(sw, /const CACHE = `studio-\$\{VERSION\}`/);
  });

  it('página pública nunca aponta para o ícone do painel', () => {
    const publicFiles = [...walk('src/views/plateia').filter((f) => !/admin|painel|_/.test(path.basename(f))), ...walk('src/views/portal'),
      ...walk('src/views/sponsor-public').filter((f) => !path.basename(f).startsWith('_')), ...walk('src/templates')];
    for (const f of publicFiles) {
      const t = read(f);
      if (!/<head|<title/.test(t)) continue;
      assert.doesNotMatch(t, /href="\/static\/favicon\.svg|href="\/favicon\.ico"|href="\/apple-touch-icon\.png"/, `${f} usa o ícone do painel`);
      assert.match(t, /rel="icon" href="\/static\/brand\/pulso\/favicon\.svg/, `${f} sem o ícone do Pulso`);
    }
  });
});

describe('identidade: o Sinal no lugar da linha de pulso (só no painel)', () => {
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`])).filter((f) => !path.basename(f).startsWith('._'));
  const pulso = ['src/views/plateia/guest.ejs', 'src/views/plateia/page.ejs', 'src/views/partials/pulse-line.ejs'];

  it('a linha de pulso fica só nas páginas públicas do Pulso', () => {
    assert.ok(exists('src/views/partials/pulse-line.ejs'), 'a plateia do Pulso continua usando');
    for (const f of walk('src/views')) if (!pulso.includes(f)) assert.doesNotMatch(read(f), /pulse-line/, `${f} ainda inclui a linha de pulso`);
    assert.match(read('src/views/plateia/page.ejs'), /pulse-line/);
    assert.doesNotMatch(css, /pulse-line/, 'o estilo da linha de pulso sai da folha do painel');
  });

  it('o Sinal tem estilo próprio e o "ao vivo" para com movimento reduzido', () => {
    assert.match(css, /\.signal \{/); assert.match(css, /@keyframes signal \{/);
    assert.match(css, /\.day-live \{[^}]*animation: signal/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.day-live \{ animation: none; \} \}/);
    assert.match(read('src/views/partials/signal.ejs'), /class="signal"[\s\S]*class="s4"/);
  });
});
