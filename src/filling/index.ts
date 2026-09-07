import type { Page } from 'playwright';
import type { Questao, Resposta } from '../ai/types.ts';
import { logger } from '../core/logger.ts';
import { pause, typingDelay, readingTime } from '../core/humanize.ts';

export type ResultadoPreenchimento = {
  slot: number;
  preenchida: boolean;
  motivo?: string;
};

/**
 * Preenche uma resposta no DOM da tentativa.
 *
 * A letra devolvida pela IA ('C') NUNCA vai direto para o input: o Moodle
 * usa valores próprios e embaralha as alternativas entre tentativas.
 * A tradução letra → inputValue é obrigatória e acontece aqui.
 */
export async function preencher(
  page: Page,
  q: Questao,
  r: Resposta,
): Promise<ResultadoPreenchimento> {
  // Pausa proporcional ao tamanho do enunciado — o log do Moodle registra
  // o instante de cada resposta.
  await pause(readingTime(q.enunciado) / 2);

  try {
    switch (q.tipo) {
      case 'multichoice':
      case 'truefalse': {
        const letra = r.a.trim().toUpperCase().slice(0, 1);
        const alt = q.alternativas.find((a) => a.letra === letra);
        if (!alt) return { slot: q.slot, preenchida: false, motivo: `letra "${r.a}" fora das alternativas` };
        await marcar(page, q, alt.inputValue);
        return { slot: q.slot, preenchida: true };
      }

      case 'multichoice-multi': {
        const letras = r.a.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
        const alvos = q.alternativas.filter((a) => letras.includes(a.letra));
        if (alvos.length === 0) return { slot: q.slot, preenchida: false, motivo: `nenhuma letra de "${r.a}" casou` };
        for (const a of alvos) {
          await marcar(page, q, a.inputValue);
          await pause(400);
        }
        return { slot: q.slot, preenchida: true };
      }

      case 'shortanswer':
      case 'essay': {
        const escopo = page.locator(`#${cssEscape(q.domId)}`);
        // Editor rico do Moodle vive num iframe e ignora fill().
        const iframe = escopo.locator('iframe[id$="_ifr"]');
        if (await iframe.count()) {
          const corpo = escopo.frameLocator('iframe[id$="_ifr"]').locator('body');
          await corpo.click();
          await corpo.pressSequentially(r.a, { delay: typingDelay() });
        } else {
          const campo = escopo.locator('textarea, input[type="text"]').first();
          await campo.click();
          await campo.pressSequentially(r.a, { delay: typingDelay() });
        }
        return { slot: q.slot, preenchida: true };
      }
    }
  } catch (e) {
    return { slot: q.slot, preenchida: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

async function marcar(page: Page, q: Questao, inputValue: string): Promise<void> {
  const escopo = page.locator(`#${cssEscape(q.domId)}`);
  const input = escopo.locator(
    `input[type="radio"][value="${inputValue}"], input[type="checkbox"][value="${inputValue}"]`,
  );
  await input.first().check({ timeout: 15_000 });
  logger.debug({ slot: q.slot, inputValue }, 'alternativa marcada');
}

/** ids do Moodle como "question-123-1" são válidos, mas escapamos por segurança. */
function cssEscape(id: string): string {
  return id.replace(/([^\w-])/g, '\$1');
}
