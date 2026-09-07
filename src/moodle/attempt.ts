import type { Page } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import type { Config } from '../config/env.ts';
import { PATHS } from '../config/selectors.ts';
import { logger } from '../core/logger.ts';
import { pause } from '../core/humanize.ts';
import { scrub } from '../core/logger.ts';

/**
 * Inicia (ou retoma) a tentativa.
 *
 * ⚠ IRREVERSÍVEL quando a APS tem tentativa única: a partir daqui a
 * tentativa está consumida, mesmo sem enviar. Quem chama é responsável
 * por ter passado pelo portão de avaliar().
 */
export async function abrirTentativa(page: Page, cfg: Config, cmid: number): Promise<number> {
  await page.goto(cfg.MOODLE_URL + PATHS.quizView(cmid), {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await pause(1500);

  const botao = page
    .locator('form[action*="startattempt"] button, form[action*="startattempt"] input[type="submit"]')
    .first();

  if (await botao.count()) {
    await Promise.all([page.waitForLoadState('domcontentloaded'), botao.click()]);
  } else {
    // Sem formulário de início: pode haver "Continuar a última tentativa".
    const continuar = page.locator('a[href*="attempt.php"]').first();
    if (!(await continuar.count())) throw new Error('Nem iniciar nem continuar disponíveis');
    await Promise.all([page.waitForLoadState('domcontentloaded'), continuar.click()]);
  }

  // O Moodle pode interpor uma confirmação ("Iniciar tentativa?").
  const confirmar = page.locator('button:has-text("Iniciar tentativa"), input[value*="Iniciar"]');
  if (await confirmar.count()) {
    await pause(900);
    await Promise.all([page.waitForLoadState('domcontentloaded'), confirmar.first().click()]);
  }

  const m = page.url().match(/[?&]attempt=(\d+)/);
  if (!m?.[1]) throw new Error(`Não cheguei numa tentativa. URL: ${page.url()}`);

  const attempt = Number(m[1]);
  logger.info({ cmid, attempt, url: page.url() }, 'tentativa aberta');
  return attempt;
}

/**
 * Espera as questões renderizarem.
 *
 * `domcontentloaded` retorna com o esqueleto da página: na primeira
 * execução o HTML capturado tinha 13KB e zero `div.que`, porque o corpo
 * ainda não havia sido montado. Sem esta espera, a extração enxerga uma
 * página vazia e o loop de páginas encerra achando que acabou.
 */
export async function aguardarQuestoes(page: Page, timeout = 30_000): Promise<number> {
  try {
    await page.locator('div.que').first().waitFor({ state: 'attached', timeout });
  } catch {
    logger.warn({ url: page.url() }, 'nenhuma div.que apareceu no tempo esperado');
    return 0;
  }
  return page.locator('div.que').count();
}

/** Navega diretamente para uma página da tentativa (0-indexada). */
export async function irParaPagina(
  page: Page,
  cfg: Config,
  attempt: number,
  cmid: number,
  pagina: number,
): Promise<number> {
  await page.goto(
    `${cfg.MOODLE_URL}/mod/quiz/attempt.php?attempt=${attempt}&cmid=${cmid}&page=${pagina}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 },
  );
  return aguardarQuestoes(page);
}

/** Total de páginas da tentativa, lido do bloco de navegação. */
export async function contarPaginas(page: Page): Promise<number> {
  const titulo = await page.title();
  const m = titulo.match(/p[áa]gina\s+\d+\s+de\s+(\d+)/i);
  if (m?.[1]) return Number(m[1]);
  // Alternativa: contar os botões do bloco de navegação da tentativa.
  const n = await page.locator('#mod_quiz_navblock a.qnbutton, .qnbutton').count();
  return n > 0 ? n : 1;
}

/** Salva o HTML da página atual para desenvolvimento offline. */
export async function salvarFixture(page: Page, nome: string): Promise<string> {
  await mkdir('tests/fixtures', { recursive: true });
  const caminho = `tests/fixtures/${nome}.html`;
  await writeFile(caminho, scrub(await page.content()), 'utf8');
  logger.info({ caminho }, 'fixture salva (gitignored)');
  return caminho;
}

/**
 * Avança SUBMETENDO o formulário da tentativa.
 *
 * Esta é a única forma de o Moodle persistir as respostas. O form posta em
 * `processattempt.php` levando os campos ocultos (attempt, thispage,
 * sesskey, slots); pular de página com `page.goto()` descarta tudo o que
 * foi preenchido — foi exatamente o que aconteceu na primeira execução,
 * que terminou com as 10 questões ainda em `notyetanswered`.
 *
 * Na última página o mesmo botão leva ao resumo (summary.php), que salva
 * as respostas SEM enviar o questionário. Enviar exige outro botão.
 */
export async function avancarSubmetendo(page: Page): Promise<boolean> {
  const proximo = page.locator('#mod_quiz-next-nav, input[name="next"], button[name="next"]').first();
  if (!(await proximo.count())) return false;
  await pause(1400);
  await Promise.all([page.waitForLoadState('domcontentloaded'), proximo.click()]);
  return true;
}

/**
 * Envia a tentativa definitivamente. IRREVERSÍVEL.
 *
 * Cuidado com os seletores: a página de resumo tem botões-chamariz
 * ("Enviar solicitação de contato", do widget de acessibilidade) que
 * casariam com qualquer :has-text("Enviar"). E o id do botão correto é
 * gerado por execução (single_button6a9f3ee1…), então também não serve
 * como âncora. Só o texto EXATO identifica o botão certo.
 */
export async function enviarTentativa(
  page: Page,
  cfg: Config,
  attempt: number,
  cmid: number,
): Promise<void> {
  await page.goto(`${cfg.MOODLE_URL}/mod/quiz/summary.php?attempt=${attempt}&cmid=${cmid}`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  // Recusa enviar se alguma questão não estiver salva.
  const naoSalvas = await page
    .locator('table.quizsummaryofattempt tbody tr')
    .filter({ hasText: /nunca respondid|não respondid/i })
    .count();
  if (naoSalvas > 0) {
    throw new Error(`${naoSalvas} questão(ões) sem resposta salva — envio abortado`);
  }

  const ALVO = 'Enviar tudo e terminar';
  const botao = page.getByRole('button', { name: ALVO, exact: true });
  if ((await botao.count()) === 0) {
    throw new Error(`Botão "${ALVO}" não encontrado na página de resumo`);
  }

  await pause(2000);
  await botao.first().click();

  // O Moodle interpõe um modal de confirmação com o MESMO rótulo.
  await pause(1500);
  const confirmar = page
    .locator('.modal, [role="dialog"]')
    .getByRole('button', { name: ALVO, exact: true });
  if (await confirmar.count()) {
    await Promise.all([page.waitForLoadState('domcontentloaded'), confirmar.first().click()]);
  } else {
    await page.waitForLoadState('domcontentloaded');
  }

  await page.waitForURL(/review\.php|view\.php/, { timeout: 45_000 }).catch(() => undefined);
  logger.warn({ attempt, cmid, url: page.url() }, 'tentativa ENVIADA');
}

/**
 * Confirma no Moodle que a tentativa consta como finalizada, e lê a nota.
 *
 * A tabela do resumo pós-envio é `quizreviewsummary` — não
 * `quizattemptsummary`, que é a lista de tentativas exibida ANTES de
 * enviar. Usar a errada fazia esta função reportar `finalizada: false`
 * numa tentativa que estava perfeitamente enviada.
 */
export async function confirmarEnvio(
  page: Page,
  cfg: Config,
  cmid: number,
): Promise<{ finalizada: boolean; nota: string | null; estado: string }> {
  await page.goto(cfg.MOODLE_URL + PATHS.quizView(cmid), {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  const estado = await page.evaluate(() => {
    const tabelas = Array.from(
      document.querySelectorAll('table.quizreviewsummary, table.quizattemptsummary'),
    );
    return tabelas.map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' | ');
  });
  const nota = estado.match(/Notas?\s+([\d,.]+\s*\/\s*[\d,.]+)/i)?.[1] ?? null;
  return { finalizada: /situa[çc][ãa]o\s+finalizada/i.test(estado), nota, estado };
}
