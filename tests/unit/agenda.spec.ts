import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { proximaExecucao, formatarEspera } from '../../src/core/agenda.ts';

describe('proximaExecucao', () => {
  test('mesmo dia quando o horário ainda não chegou', () => {
    const agora = new Date(2026, 8, 8, 6, 0, 0);
    const p = proximaExecucao('07:20', agora);
    assert.equal(p.getDate(), 8);
    assert.equal(p.getHours(), 7);
    assert.equal(p.getMinutes(), 20);
  });

  test('dia seguinte quando o horário já passou', () => {
    const agora = new Date(2026, 8, 8, 9, 0, 0);
    const p = proximaExecucao('07:20', agora);
    assert.equal(p.getDate(), 9);
    assert.equal(p.getHours(), 7);
  });

  test('exatamente no horário agenda para amanhã (não dispara em loop)', () => {
    const agora = new Date(2026, 8, 8, 7, 20, 0, 0);
    const p = proximaExecucao('07:20', agora);
    assert.equal(p.getDate(), 9);
  });

  test('vira o mês corretamente', () => {
    const agora = new Date(2026, 8, 30, 23, 0, 0);
    const p = proximaExecucao('07:20', agora);
    assert.equal(p.getMonth(), 9); // outubro
    assert.equal(p.getDate(), 1);
  });

  test('vira o ano corretamente', () => {
    const agora = new Date(2026, 11, 31, 23, 0, 0);
    const p = proximaExecucao('07:20', agora);
    assert.equal(p.getFullYear(), 2027);
    assert.equal(p.getMonth(), 0);
    assert.equal(p.getDate(), 1);
  });

  test('a espera nunca é negativa nem maior que 24h', () => {
    for (let h = 0; h < 24; h++) {
      for (const min of [0, 19, 20, 21, 59]) {
        const agora = new Date(2026, 8, 8, h, min, 30);
        const espera = proximaExecucao('07:20', agora).getTime() - agora.getTime();
        assert.ok(espera > 0, `espera não-positiva às ${h}:${min}`);
        assert.ok(espera <= 24 * 3600_000, `espera > 24h às ${h}:${min}`);
      }
    }
  });

  test('zera segundos e milissegundos', () => {
    const p = proximaExecucao('07:20', new Date(2026, 8, 8, 6, 0, 45, 123));
    assert.equal(p.getSeconds(), 0);
    assert.equal(p.getMilliseconds(), 0);
  });
});

describe('formatarEspera', () => {
  test('minutos', () => assert.equal(formatarEspera(25 * 60_000), '25min'));
  test('horas e minutos', () => assert.equal(formatarEspera(3 * 3600_000 + 5 * 60_000), '3h05min'));
  test('menos de um minuto', () => assert.match(formatarEspera(5_000), /menos de 1min/));
});
