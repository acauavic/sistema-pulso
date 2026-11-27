// Regra única de quando a IA pode escrever num campo (src/public/aifill.js): só no que está vazio, no valor que veio na tela
// ou no que a própria IA pôs da última vez. O que a pessoa escreveu (antes ou enquanto a IA trabalhava) fica.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AIFill = require('../src/public/aifill.js');

const input = (value = '', defaultValue = value, label = 'Título') => ({ tagName: 'INPUT', value, defaultValue, dataset: {}, labels: [{ textContent: label }] });
const select = (value, defaultValue) => ({ tagName: 'SELECT', value, options: [{ value: defaultValue, defaultSelected: true }, { value: 'b', defaultSelected: false }, { value: 'c', defaultSelected: false }], dataset: {}, labels: [{ textContent: 'Responsável' }] });

describe('aifill: a IA não atropela o que a pessoa escreveu', () => {
  it('campo vazio ou com o valor que veio na tela recebe o texto da IA', () => {
    const f = AIFill.create();
    const a = input(''); const b = input('Texto de antes');
    assert.equal(f.write(a, 'Fechar a capa'), true); assert.equal(a.value, 'Fechar a capa');
    assert.equal(f.write(b, 'Texto novo'), true); assert.equal(b.value, 'Texto novo');
    assert.deepEqual(f.kept(), []);
  });

  it('o que a pessoa digitou enquanto a IA trabalhava fica, e o nome do campo entra em "mantidos"', () => {
    const f = AIFill.create();
    const t = input('');
    t.value = 'Meu título'; // digitou durante a espera
    assert.equal(f.write(t, 'Título da IA'), false);
    assert.equal(t.value, 'Meu título');
    assert.deepEqual(f.kept(), ['Título']);
  });

  it('a segunda resposta da IA troca o que a primeira escreveu, mas não o que a pessoa ajustou depois', () => {
    const f = AIFill.create();
    const t = input(''); const d = input('', '', 'Detalhes');
    f.write(t, 'Primeira'); f.write(d, 'Detalhe 1');
    t.value = 'Ajustei'; // mexeu no título entre uma resposta e outra
    assert.equal(f.write(t, 'Segunda'), false); assert.equal(t.value, 'Ajustei');
    assert.equal(f.write(d, 'Detalhe 2'), true); assert.equal(d.value, 'Detalhe 2');
  });

  it('select: troca o padrão da tela, não a escolha da pessoa', () => {
    const f = AIFill.create();
    const s = select('a', 'a');
    assert.equal(f.write(s, 'b'), true); assert.equal(s.value, 'b');
    const s2 = select('a', 'a'); s2.value = 'c'; // escolheu outra pessoa
    assert.equal(f.write(s2, 'b'), false); assert.equal(s2.value, 'c');
  });

  it('valor vazio da IA não apaga nada; campo marcado com data-ai-free sempre aceita', () => {
    const f = AIFill.create();
    const t = input('Tinha');
    assert.equal(f.write(t, ''), false); assert.equal(f.write(t, null), false); assert.equal(t.value, 'Tinha');
    const h = input('x', ''); h.dataset.aiFree = '1';
    assert.equal(f.write(h, 'y'), true);
  });

  it('frase do que ficou como a pessoa escreveu', () => {
    assert.equal(AIFill.keptText([]), '');
    assert.equal(AIFill.keptText(['Título']), 'Mantive o que você escreveu em Título.');
    assert.equal(AIFill.keptText(['Título', 'Detalhes', 'Responsável']), 'Mantive o que você escreveu em Título, Detalhes e Responsável.');
  });
});
