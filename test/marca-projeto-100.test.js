// Marca do Projeto 100 nas páginas públicas: ícones próprios, folha de marca com os tokens dele (Azul 100 é a ação,
// violeta é o externo) e as páginas do convidado carregando a folha depois da delas. Sem banco.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const BRAND = 'src/public/brand/projeto-100';

describe('marca do Projeto 100', () => {
  it('a pasta da marca tem ícone, ícone do celular e a folha de tokens', () => {
    for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'brand.css']) {
      assert.ok(fs.existsSync(path.join(root, BRAND, f)), `falta ${f}`);
    }
    const png = fs.readFileSync(path.join(root, BRAND, 'apple-touch-icon.png'));
    assert.equal(png.readUInt32BE(16), 180, 'o ícone do celular é 180×180');
    const ico = fs.readFileSync(path.join(root, BRAND, 'favicon.ico'));
    assert.equal(ico.readUInt16LE(4), 3, 'o .ico leva 16, 32 e 48');
  });

  it('o ícone é a marca 1 + ∞ = 100, no gradiente do manual', () => {
    const svg = read(`${BRAND}/favicon.svg`);
    for (const cor of ['#3158FF', '#9A55EA', '#FF4E9B', '#0E0F1A']) assert.ok(svg.includes(cor), cor);
    assert.match(svg, /<circle[^>]*\/>\s*<circle/, 'os dois círculos do infinito');
    assert.match(svg, /<rect x="12"/, 'o traço do 1');
  });

  it('a folha de marca troca os tokens, e não a estrutura', () => {
    const css = read(`${BRAND}/brand.css`);
    assert.match(css, /--lime: var\(--p100-azul\)/, 'a ação é o Azul 100');
    assert.match(css, /--plum: var\(--p100-violeta\)/, 'o externo é o violeta');
    assert.match(css, /font-family: "Archivo"/, 'o display é Archivo');
    assert.doesNotMatch(css, /#C8FF42/, 'nada de lime do Pulso');
    // tokens do manual
    for (const cor of ['#3158FF', '#9A55EA', '#FF4E9B', '#0E0F1A', '#5B5E6B', '#ECEEF3', '#F7F7F4']) assert.ok(css.includes(cor), cor);
    // a folha troca cor, fonte e o ponto do botão; nada de grade nem de posição (a estrutura é a mesma)
    assert.doesNotMatch(css, /\b(position|grid-template|flex-direction)\b/, 'a folha não mexe em layout');
  });

  it('as páginas públicas do convidado carregam a folha do projeto depois da delas', () => {
    for (const v of ['src/views/portal/guest.ejs', 'src/views/portal/pos-gravacao.ejs', 'src/views/plateia/page.ejs',
      'src/views/plateia/guest.ejs', 'src/views/sponsor-public/portal.ejs', 'src/views/sponsor-public/brief.ejs']) {
      const t = read(v);
      const own = t.indexOf('/static/');
      const brand = t.indexOf('brandCss');
      assert.ok(brand > own && own > -1, `${v}: a folha da marca vem depois do CSS da página`);
    }
  });

  it('o convite e o media kit ficam com a identidade própria deles (só o ícone segue o projeto)', () => {
    for (const f of ['src/templates/convite-pulso.html', 'src/templates/media-kit.html']) {
      const t = read(f);
      assert.ok(!t.includes('brand_css'), `${f}: documento de identidade própria não recebe folha de marca`);
      assert.ok(t.includes('{{brand_dir}}'), `${f}: o ícone segue o projeto`);
    }
  });
});
