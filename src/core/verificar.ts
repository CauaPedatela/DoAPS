/**
 * Confere no Moodle o que REALMENTE ficou gravado numa tentativa.
 *
 * O relatório do run diz "preenchida" quando o clique não deu erro — isso
 * não é a mesma coisa que o Moodle ter aceitado a resposta. Esta checagem
 * independente existe por causa de um caso real: 10/10 "preenchidas" com
 * as 10 questões ainda em `notyetanswered`.
 *
 * Cuidado com o sentinela: o Moodle mantém um radio `value="-1"`
 * (visually-hidden) marcado por padrão para significar "sem resposta".
 * Contá-lo como resposta produz um falso positivo perfeito.
 *
 *   node --env-file=.env src/core/verificar.ts <attempt> <cmid> <paginas>
 */
import { loadConfig } from '../config/env.ts';
import { launch } from './browser.ts';
import { login } from '../moodle/auth.ts';
import { aguardarQuestoes, irParaPagina } from '../moodle/attempt.ts';

const [attempt, cmid, paginas] = process.argv.slice(2).map(Number);
if (!attempt || !cmid) {
  console.error('uso: node --env-file=.env src/core/verificar.ts <attempt> <cmid> [paginas]');
  process.exit(1);
}

const cfg = loadConfig();
const s = await launch(cfg);
try {
  const page = await login(s.context, cfg);
  let respondidas = 0;
  let vazias = 0;

  for (let p = 0; p < (paginas || 10); p++) {
    await irParaPagina(page, cfg, attempt, cmid, p);
    await aguardarQuestoes(page);
    const questoes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div.que')).map((div) => {
        // Exclui o sentinela -1: ele vem checked por padrão.
        const sel = div.querySelector<HTMLInputElement>(
          'input[type=radio]:checked:not([value="-1"]), input[type=checkbox]:checked:not([value="-1"])',
        );
        const texto = div.querySelector<HTMLTextAreaElement>('textarea')?.value?.trim();
        const rotulo = sel
          ? document.getElementById(sel.getAttribute('aria-labelledby') ?? '')?.textContent
          : null;
        return {
          estado: Array.from(div.classList).find((c) => /answered|complete/.test(c)) ?? '?',
          valor: sel?.value ?? null,
          rotulo: (rotulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 52),
          discursiva: texto ? texto.slice(0, 40) : null,
        };
      });
    });

    for (const q of questoes) {
      const ok = q.valor !== null || Boolean(q.discursiva);
      if (ok) respondidas++;
      else vazias++;
      console.log(
        `  p${String(p).padStart(2)} ${ok ? '✓' : '✗'} [${q.estado}] ` +
          (q.valor !== null ? `value=${q.valor} ${q.rotulo}` : q.discursiva ?? 'SEM RESPOSTA'),
      );
    }
  }

  console.log(`\n${respondidas} respondidas · ${vazias} vazias`);
  process.exitCode = vazias === 0 ? 0 : 1;
} finally {
  await s.close();
}
