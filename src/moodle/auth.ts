import type { BrowserContext, Page } from 'playwright';
import type { Config } from '../config/env.ts';
import { S, PATHS } from '../config/selectors.ts';
import { logger } from '../core/logger.ts';
import { pause, typingDelay } from '../core/humanize.ts';

export class CredenciaisInvalidasError extends Error {
  override readonly name = 'CredenciaisInvalidasError';
}

/** Está logado? Checa sem depender de texto traduzível. */
export async function estaLogado(page: Page, cfg: Config): Promise<boolean> {
  await page.goto(cfg.MOODLE_URL + PATHS.myCourses, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  // O Moodle expõe M.cfg.userId no HTML: 0 = anônimo, >0 = autenticado.
  // Mais confiável que procurar por menu de usuário, que muda com o tema.
  const userId = await page.evaluate<number>(
    // @ts-expect-error — M é global injetado pelo Moodle
    () => (typeof M !== 'undefined' && M?.cfg?.userId) || 0,
  );
  return userId > 0;
}

/**
 * Autentica no Moodle.
 *
 * ⚠ NÃO repete em caso de credencial rejeitada. O Moodle bloqueia a conta
 * após N tentativas falhas; insistir automaticamente transformaria um erro
 * de digitação no .env em uma conta travada.
 */
export async function login(context: BrowserContext, cfg: Config): Promise<Page> {
  const page = await context.newPage();

  if (await estaLogado(page, cfg)) {
    logger.info('sessão existente reaproveitada — login dispensado');
    return page;
  }

  logger.info('autenticando');

  // O formulário do tema Snap começa com `display:none` e só é revelado
  // pelo JavaScript do tema. Se um recurso falhar ao carregar — e o
  // servidor do AVA reseta conexões sob carga, atingindo `core/first.js` e
  // a folha de estilo — o campo existe no DOM mas nunca fica visível, e o
  // clique falha por timeout depois de 30s.
  //
  // Recarregar resolve, porque a falha é de rede e não de estrutura.
  let visivel = false;
  for (let tentativa = 1; tentativa <= 3 && !visivel; tentativa++) {
    await page.goto(cfg.MOODLE_URL + PATHS.login, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    try {
      await page.locator(S.login.username).waitFor({ state: 'visible', timeout: 20_000 });
      visivel = true;
    } catch {
      logger.warn({ tentativa }, 'formulário de login não apareceu — recarregando');
      await pause(2500);
    }
  }

  if (!visivel) {
    throw new Error(
      'O formulário de login não ficou visível após 3 tentativas. ' +
        'O campo existe no HTML mas o tema não o revelou — normalmente é recurso ' +
        'do AVA falhando ao carregar (o servidor reseta conexões sob carga). ' +
        'Tente de novo em alguns minutos.',
    );
  }

  // O logintoken é o CSRF do Moodle; sua ausência significa que a página
  // não é a de login que esperamos (redirect, manutenção, SSO novo…).
  const token = await page.locator(S.login.token).getAttribute('value');
  if (!token) {
    throw new Error(
      'Página de login sem logintoken — o alvo mudou. Rode `npm run browser:check`.',
    );
  }

  await pause(900);
  await page.locator(S.login.username).click();
  await page.locator(S.login.username).pressSequentially(cfg.MOODLE_USERNAME, {
    delay: typingDelay(),
  });

  await pause(500);
  await page.locator(S.login.password).click();
  await page.locator(S.login.password).pressSequentially(cfg.MOODLE_PASSWORD, {
    delay: typingDelay(),
  });

  await pause(700);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator(S.login.submit).click(),
  ]);

  if (await estaLogado(page, cfg)) {
    logger.info('autenticado');
    return page;
  }

  // Distingue credencial errada de falha genérica, para a mensagem ser útil.
  await page.goto(cfg.MOODLE_URL + PATHS.login, { waitUntil: 'domcontentloaded' });
  const erro = await page
    .locator(S.login.error)
    .first()
    .textContent()
    .catch(() => null);

  throw new CredenciaisInvalidasError(
    `Login recusado pelo Moodle${erro ? `: ${erro.trim()}` : ''}. ` +
      'Confira MOODLE_USERNAME e MOODLE_PASSWORD no .env. ' +
      'Não vou repetir automaticamente — tentativas seguidas bloqueiam a conta.',
  );
}
