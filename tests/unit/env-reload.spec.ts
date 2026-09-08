import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recarregarEnv } from '../../src/config/env.ts';

const dir = mkdtempSync(join(tmpdir(), 'doaps-env-'));
const arquivo = join(dir, '.env');
const escrever = (s: string) => writeFileSync(arquivo, s, 'utf8');

describe('recarregarEnv', () => {
  test('SOBRESCREVE valor já presente em process.env', () => {
    // É o ponto central: node --env-file lê uma vez só, e
    // process.loadEnvFile() não sobrescreve o que já existe. Sem
    // sobrescrever, um daemon aberto por dias não seria ajustável.
    process.env['DOAPS_T1'] = 'antigo';
    escrever('DOAPS_T1=novo\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T1'], 'novo');
  });

  test('ignora comentários e linhas vazias', () => {
    escrever('# comentário\n\n  # indentado\nDOAPS_T2=ok\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T2'], 'ok');
  });

  test('preserva "=" dentro do valor', () => {
    escrever('DOAPS_T3=a=b=c\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T3'], 'a=b=c');
  });

  test('remove aspas envolventes', () => {
    escrever('DOAPS_T4="com aspas"\nDOAPS_T5=\'simples\'\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T4'], 'com aspas');
    assert.equal(process.env['DOAPS_T5'], 'simples');
  });

  test('arquivo inexistente não lança', () => {
    assert.doesNotThrow(() => recarregarEnv(join(dir, 'nao-existe')));
  });

  test('reflete mudança entre duas leituras', () => {
    escrever('DOAPS_T6=8\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T6'], '8');
    escrever('DOAPS_T6=3\n');
    recarregarEnv(arquivo);
    assert.equal(process.env['DOAPS_T6'], '3');
  });

  test.after(() => rmSync(dir, { recursive: true, force: true }));
});
