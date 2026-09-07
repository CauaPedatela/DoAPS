import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  humanDelay,
  readingTime,
  typingDelay,
  enforceFloor,
} from '../../src/core/humanize.ts';

const sample = (fn: () => number, n = 20_000): number[] =>
  Array.from({ length: n }, fn);

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe('humanDelay', () => {
  test('mediana fica próxima do valor pedido', () => {
    const xs = sample(() => humanDelay(3000));
    const m = median(xs);
    assert.ok(m > 2700 && m < 3300, `mediana fora da faixa: ${m}`);
  });

  test('nunca devolve valor não-positivo', () => {
    const xs = sample(() => humanDelay(60), 5000);
    assert.ok(Math.min(...xs) >= 50, `mínimo inválido: ${Math.min(...xs)}`);
  });

  test('é assimétrico à direita (lognormal, não uniforme)', () => {
    // Numa lognormal a média supera a mediana — é justamente o que
    // distingue tempo humano de um random() uniforme. Se esta asserção
    // falhar, a distribuição virou retangular e é ela própria um padrão.
    const xs = sample(() => humanDelay(3000));
    assert.ok(mean(xs) > median(xs) * 1.02, 'distribuição não é assimétrica à direita');
  });

  test('dispersão bate com o sigma configurado', () => {
    // Numa lognormal o coeficiente de variação é sqrt(e^(σ²) − 1).
    // Para σ=0.35 isso dá ≈0.36. Verificar o CV testa o parâmetro de
    // verdade — contar valores distintos só mediria colisão de inteiros.
    const xs = sample(() => humanDelay(3000));
    const mu = mean(xs);
    const dp = Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
    const cv = dp / mu;
    assert.ok(cv > 0.25 && cv < 0.5, `coeficiente de variação fora do esperado: ${cv.toFixed(3)}`);
  });
});

describe('readingTime', () => {
  test('cresce com o tamanho do texto', () => {
    const curto = mean(sample(() => readingTime('uma frase curta'), 2000));
    const longo = mean(sample(() => readingTime('palavra '.repeat(300)), 2000));
    assert.ok(longo > curto * 3, `não escalou: curto=${curto} longo=${longo}`);
  });

  test('texto vazio ainda gera pausa mínima', () => {
    assert.ok(readingTime('') >= 50);
  });
});

describe('typingDelay', () => {
  test('fica numa faixa plausível de digitação humana', () => {
    const m = median(sample(typingDelay));
    assert.ok(m > 60 && m < 140, `mediana implausível: ${m}ms/caractere`);
  });
});

describe('enforceFloor', () => {
  test('espera quando a operação foi rápida demais', async () => {
    const t0 = Date.now();
    const esperou = await enforceFloor(Date.now(), 250);
    assert.ok(esperou > 0);
    assert.ok(Date.now() - t0 >= 240);
  });

  test('não espera quando o piso já foi cumprido', async () => {
    const esperou = await enforceFloor(Date.now() - 10_000, 250);
    assert.equal(esperou, 0);
  });
});
