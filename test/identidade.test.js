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
