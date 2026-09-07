import { logger } from './logger.ts';
import { humanDelay, sleep } from './humanize.ts';

/**
 * Backoff exponencial com jitter.
 *
 * Não é precaução teórica: o free tier do Gemini devolveu 503
 * ("high demand") em teste real com `gemini-3.8-flash`. Sem retry, um run
 * inteiro morreria por congestionamento momentâneo do provedor.
 */
export type RetryOpts = {
  tentativas?: number;
  baseMs?: number;
  /** Decide se vale repetir. Padrão: 429, 5xx e erros de rede. */
  repetivel?: (erro: unknown) => boolean;
  rotulo?: string;
};

function statusDe(erro: unknown): number | undefined {
  if (typeof erro !== 'object' || erro === null) return undefined;
  const e = erro as Record<string, unknown>;
  if (typeof e['status'] === 'number') return e['status'];
  if (typeof e['statusCode'] === 'number') return e['statusCode'];
  return undefined;
}

export function repetivelPorPadrao(erro: unknown): boolean {
  const status = statusDe(erro);
  if (status !== undefined) return status === 429 || status === 408 || status >= 500;
  // Sem status: provavelmente falha de rede/DNS/timeout — vale repetir.
  return erro instanceof Error;
}

export async function comRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const {
    tentativas = 5,
    baseMs = 1200,
    repetivel = repetivelPorPadrao,
    rotulo = 'operação',
  } = opts;

  let ultimo: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (erro) {
      ultimo = erro;
      if (i === tentativas || !repetivel(erro)) break;

      // Exponencial com jitter — evita que várias falhas sincronizem
      // e voltem a bater no servidor todas no mesmo instante.
      const espera = humanDelay(baseMs * 2 ** (i - 1), 0.25);
      logger.warn(
        { rotulo, tentativa: i, de: tentativas, status: statusDe(erro), esperaMs: espera },
        'falhou, repetindo',
      );
      await sleep(espera);
    }
  }
  throw ultimo;
}
