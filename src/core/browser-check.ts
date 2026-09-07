/**
 * Verificação de ambiente: o Playwright consegue dirigir o navegador
 * e alcançar o AVA?  Não usa credenciais.
 *
 *   npm run browser:check
 */
import { chromium } from 'playwright';
import { S } from '../config/selectors.ts';

const channel = (process.env['BROWSER_CHANNEL'] ?? 'chrome') as 'chrome' | 'msedge' | 'chromium';
const url = (process.env['MOODLE_URL'] ?? 'https://avagrad.unievangelica.edu.br') + '/login/index.php';

const browser = await chromium.launch({ channel, headless: true });
try {
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const checks: Array<[string, boolean]> = [
    [`navegador '${channel}' inicia`, true],
    ['página de login carrega', (await page.title()).length > 0],
    ['campo #username', (await page.locator(S.login.username).count()) === 1],
    ['campo #password', (await page.locator(S.login.password).count()) === 1],
    ['botão #loginbtn', (await page.locator(S.login.submit).count()) === 1],
    ['logintoken (CSRF)', Boolean(await page.locator(S.login.token).getAttribute('value'))],
  ];

  let ok = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}`);
    if (!passed) ok = false;
  }
  console.log(ok ? '\nAmbiente pronto.' : '\nAlgo mudou no alvo — revise src/config/selectors.ts');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
