import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataMoodle, parseDuracao, avaliar, type Triagem } from '../../src/moodle/triage.ts';
import type { Config } from '../../src/config/env.ts';

describe('parseDataMoodle', () => {
  test('lê o formato pt-BR do Moodle', () => {
    const d = parseDataMoodle('domingo, 13 set. 2026, 23:59');
    assert.ok(d);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8); // setembro = 8
    assert.equal(d.getDate(), 13);
    assert.equal(d.getHours(), 23);
    assert.equal(d.getMinutes(), 59);
  });

  test('aceita mês sem ponto e dia com um dígito', () => {
    const d = parseDataMoodle('segunda-feira, 3 ago 2026, 09:05');
    assert.ok(d);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getDate(), 3);
    assert.equal(d.getHours(), 9);
  });

  test('todos os meses em português são reconhecidos', () => {
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    meses.forEach((m, i) => {
      const d = parseDataMoodle(`x, 1 ${m}. 2026, 10:00`);
      assert.ok(d, `falhou em ${m}`);
      assert.equal(d.getMonth(), i, `mês errado para ${m}`);
    });
  });

  test('devolve null em texto sem data', () => {
    assert.equal(parseDataMoodle('Responder questionário'), null);
  });
});

describe('parseDuracao', () => {
  test('horas e minutos', () => assert.equal(parseDuracao('1 hora 40 minutos'), 100));
  test('só minutos', () => assert.equal(parseDuracao('45 minutos'), 45));
  test('só horas', () => assert.equal(parseDuracao('2 horas'), 120));
  test('sem duração', () => assert.equal(parseDuracao('Sem limite'), null));
});

const cfg = { DEADLINE_MARGIN_MINUTES: 120 } as Config;
const base: Triagem = {
  cmid: 1, titulo: 'APS', tentativasPermitidas: 1, tentativasUsadas: 0,
  tentativasRestantes: 1, abreEm: null, fechaEm: null, duracaoMaxMin: 100,
  podeIniciar: true, emAndamento: false,
};
const daquiA = (min: number) => new Date(Date.now() + min * 60_000);

describe('avaliar — o portão que protege as tentativas', () => {
  test('bloqueia a ÚLTIMA tentativa sem liberação explícita', () => {
    const v = avaliar(base, cfg, { permitirUltimaTentativa: false });
    assert.equal(v.ok, false);
    assert.match(v.motivo, /ÚLTIMA tentativa/);
  });

  test('libera a última quando autorizado', () => {
    assert.equal(avaliar(base, cfg, { permitirUltimaTentativa: true }).ok, true);
  });

  test('com 2 permitidas e 0 usadas, roda sem flag', () => {
    const t = { ...base, tentativasPermitidas: 2, tentativasRestantes: 2 };
    assert.equal(avaliar(t, cfg, { permitirUltimaTentativa: false }).ok, true);
  });

  test('sem tentativas restantes, nunca abre', () => {
    const t = { ...base, tentativasRestantes: 0 };
    assert.equal(avaliar(t, cfg, { permitirUltimaTentativa: true }).ok, false);
  });

  test('recusa quando o prazo já passou', () => {
    const t = { ...base, fechaEm: daquiA(-60) };
    assert.match(avaliar(t, cfg, { permitirUltimaTentativa: true }).motivo, /encerrado/);
  });

  test('recusa quando falta menos que a margem de prazo', () => {
    const t = { ...base, fechaEm: daquiA(30) };
    const v = avaliar(t, cfg, { permitirUltimaTentativa: true });
    assert.equal(v.ok, false);
    assert.match(v.motivo, /margem/);
  });

  test('aceita quando o prazo está confortável', () => {
    const t = { ...base, fechaEm: daquiA(60 * 24) };
    assert.equal(avaliar(t, cfg, { permitirUltimaTentativa: true }).ok, true);
  });

  test('recusa antes da abertura', () => {
    const t = { ...base, abreEm: daquiA(60) };
    assert.match(avaliar(t, cfg, { permitirUltimaTentativa: true }).motivo, /abre em/);
  });

  test('tentativa em andamento é retomada, não bloqueada', () => {
    const t = { ...base, emAndamento: true, tentativasRestantes: 0 };
    assert.equal(avaliar(t, cfg, { permitirUltimaTentativa: false }).ok, true);
  });

  test('sem botão de iniciar, recusa', () => {
    const t = { ...base, podeIniciar: false };
    assert.equal(avaliar(t, cfg, { permitirUltimaTentativa: true }).ok, false);
  });
});
