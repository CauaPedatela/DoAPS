import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Config } from '../config/env.ts';
import { logger } from './logger.ts';

/**
 * ⚠ Contém o cookie MoodleSession ativo. Vale tanto quanto a senha
 * enquanto a sessão durar (4h, medido em docs/ARQUITETURA.md §2).
 * Está no .gitignore. Nunca versionar, nunca colar em issue.
 */
export const STATE_PATH = '.auth/state.json';

export type Session = {
  browser: Browser;
  context: BrowserContext;
  /** Persiste cookies para reaproveitar a sessão no próximo run. */
  save: () => Promise<void>;
  close: () => Promise<void>;
};

export async function launch(cfg: Config): Promise<Session> {
  const reuse = existsSync(STATE_PATH);

  const browser = await chromium.launch({
    // Usa o Chrome instalado na máquina em vez do Chromium do Playwright:
    // sem download de 150MB e com fingerprint de navegador real.
    channel: cfg.BROWSER_CHANNEL,
    headless: !cfg.HEADED,
  });

  const context = await browser.newContext({
    // Coerente com o que o próprio M.cfg do servidor reporta (§2)
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
    ...(reuse ? { storageState: STATE_PATH } : {}),
  });

  logger.info(
    { channel: cfg.BROWSER_CHANNEL, headed: cfg.HEADED, sessaoReaproveitada: reuse },
    'navegador iniciado',
  );

  return {
    browser,
    context,
    async save() {
      await mkdir(dirname(STATE_PATH), { recursive: true });
      await context.storageState({ path: STATE_PATH });
      logger.debug('estado de sessão salvo');
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/** Apaga a sessão salva — use ao terminar se não for reaproveitar. */
export async function clearSession(): Promise<void> {
  await rm(STATE_PATH, { force: true });
  logger.info('sessão salva apagada');
}
