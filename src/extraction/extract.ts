import type { Page } from 'playwright';
import { hashQuestao } from './normalize.ts';
import type { Questao, TipoQuestao } from '../ai/types.ts';
import { logger } from '../core/logger.ts';

const LETRAS = 'ABCDEFGHIJ';

/**
 * Extrai as questões da página de tentativa.
 *
 * Só o essencial sai daqui: enunciado e alternativas em texto puro. Nada
 * de HTML, CSS, navegação ou informação de nota — isso reduz o payload da
 * IA em ~97% e, mais importante, remove ruído que atrapalharia a resposta.
 */
export async function extrairQuestoes(page: Page): Promise<Questao[]> {
  const brutas = await page.evaluate(() => {
    const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

    return Array.from(document.querySelectorAll<HTMLElement>('div.que')).map((div, idx) => {
      const classes = Array.from(div.classList);

      // O enunciado pode ter imagens; capturamos as URLs à parte.
      //
      // Imagens do filtro TeX do Moodle (/filter/tex/) NÃO são figuras:
      // são fórmulas e texto renderizados como PNG, e o `alt` carrega o
      // conteúdo original. Baixá-las e mandar para a visão seria caro e
      // pior — o alt já entrega o texto exato.
      const qtext = div.querySelector('.qtext');
      const todasImgs = Array.from(qtext?.querySelectorAll('img') ?? []);
      const imagens = todasImgs.filter((i) => !i.src.includes('/filter/tex/')).map((i) => i.src);
      const textoTex = todasImgs
        .filter((i) => i.src.includes('/filter/tex/'))
        .map((i) => i.alt || i.title || '')
        .filter(Boolean);

      // Cada alternativa é uma linha .r0/.r1/... dentro de .answer
      const linhas = Array.from(div.querySelectorAll<HTMLElement>('.answer > div'));
      const alternativas = linhas
        .map((linha) => {
          const input = linha.querySelector<HTMLInputElement>(
            'input[type="radio"], input[type="checkbox"]',
          );
          if (!input) return null;
          const label = linha.querySelector('label, .flex-fill, div');
          return {
            // O value real do Moodle. NUNCA coincide com a letra exibida,
            // e as alternativas são embaralhadas entre tentativas.
            inputValue: input.value,
            inputName: input.name,
            texto: limpar(label?.textContent).replace(/^[a-j][).]\s*/i, ''),
            imagem: Array.from(linha.querySelectorAll("img")).find(i => !i.src.includes("/filter/tex/"))?.src,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && x.inputValue !== '-1');

      const textarea = div.querySelector<HTMLTextAreaElement>('textarea');
      const inputTexto = div.querySelector<HTMLInputElement>(
        '.qtype_shortanswer input[type="text"], input[type="text"]',
      );

      return {
        idx,
        domId: div.id,
        classes,
        enunciado: [limpar(qtext?.textContent), ...textoTex].filter(Boolean).join(" "),
        imagens,
        alternativas,
        nomeTextarea: textarea?.name ?? null,
        nomeInputTexto: inputTexto?.name ?? null,
        slotTexto: limpar(div.querySelector('.qno')?.textContent),
      };
    });
  });

  const questoes: Questao[] = [];
  for (const b of brutas) {
    const tipo = classificar(b.classes, b.alternativas.length, b.nomeTextarea, b.nomeInputTexto);
    if (!tipo) {
      logger.warn({ domId: b.domId, classes: b.classes }, 'tipo de questão não suportado — pulando');
      continue;
    }

    const inputName =
      b.alternativas[0]?.inputName ?? b.nomeTextarea ?? b.nomeInputTexto ?? '';

    questoes.push({
      slot: Number(b.slotTexto) || b.idx + 1,
      domId: b.domId,
      inputName,
      tipo,
      enunciado: b.enunciado,
      imagens: b.imagens,
      alternativas: b.alternativas.map((a, i) => ({
        letra: LETRAS[i] ?? String(i),
        inputValue: a.inputValue,
        texto: a.texto,
        ...(a.imagem ? { imagem: a.imagem } : {}),
      })),
      hash: hashQuestao(b.enunciado, b.alternativas.map((a) => a.texto)),
    });
  }

  logger.info({ total: questoes.length }, 'questões extraídas');
  return questoes;
}

function classificar(
  classes: string[],
  nAlternativas: number,
  nomeTextarea: string | null,
  nomeInputTexto: string | null,
): TipoQuestao | null {
  const tem = (c: string) => classes.includes(c);
  if (tem('truefalse')) return 'truefalse';
  if (tem('essay') || (nomeTextarea && nAlternativas === 0)) return 'essay';
  if (tem('shortanswer') || (nomeInputTexto && nAlternativas === 0)) return 'shortanswer';
  if (tem('multichoice')) return nAlternativas > 0 ? 'multichoice' : null;
  return nAlternativas > 0 ? 'multichoice' : null;
}
