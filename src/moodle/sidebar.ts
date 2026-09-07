import type { Page } from 'playwright';
import type { Config } from '../config/env.ts';
import { APS_PATTERN, PATHS } from '../config/selectors.ts';
import { logger } from '../core/logger.ts';
import { pause } from '../core/humanize.ts';

/** Uma atividade "APS NN" localizada na barra lateral de uma disciplina. */
export type ItemAPS = {
  cursoId: number;
  cursoNome: string;
  /** Número da APS: "APS 05" → 5 */
  numero: number;
  nome: string;
  /** id do course module (cmid) */
  cmid: number;
  /** quiz | assign | outro — define como responder */
  tipo: string;
  url: string;
  /** Estava no índice lateral? Se não, provavelmente encerrada/oculta. */
  noIndice: boolean;
  /** true=feita, false=pendente, null=curso sem rastreamento de conclusão. */
  concluida: boolean | null;
};

/**
 * Abre a disciplina e varre o índice lateral atrás de "APS NN".
 *
 * O nome da disciplina sai do <h1> da página, não do card em /my/courses.php.
 */
export async function varrerAPS(
  page: Page,
  cfg: Config,
  cursoId: number,
): Promise<{ cursoNome: string; itens: ItemAPS[] }> {
  await page.goto(cfg.MOODLE_URL + PATHS.course(cursoId), {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await pause(1200);

  const dados = await page.evaluate(() => {
    const limpar = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
    const h1 = document.querySelector('h1');

    /**
     * Estado de conclusão, lido do próprio índice do Moodle:
     *   <li data-for="cm" data-id="2886250">
     *     <span data-for="cm_completion" data-value="1"> …
     * data-value 1 = feito, 0 = pendente, ausente = curso sem
     * rastreamento de conclusão (aí não dá para afirmar nada).
     */
    const concluidaDe = (a: HTMLAnchorElement): boolean | null => {
      const li = a.closest('[data-for="cm"]');
      const span = li?.querySelector('[data-for="cm_completion"]');
      const v = span?.getAttribute('data-value');
      if (v === null || v === undefined) return null;
      return v === '1';
    };

    const coletar = (sel: string, origem: 'indice' | 'corpo') =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>(sel)).map((a) => ({
        texto: limpar(a.textContent),
        href: a.href,
        origem,
        concluida: origem === 'indice' ? concluidaDe(a) : null,
      }));

    return {
      nome: limpar(h1?.textContent ?? ''),
      // O índice lateral é a fonte principal, mas o Moodle omite dele
      // atividades encerradas ou ocultas — visto na APS 01 de Pesquisa
      // Operacional. Varremos o corpo também e deixamos a triagem decidir:
      // é melhor achar um candidato a mais e descartá-lo do que perder uma
      // APS em silêncio.
      links: [
        ...coletar('#courseindex a[href*="/mod/"]', 'indice'),
        ...coletar('a[href*="/mod/"]', 'corpo'),
      ],
    };
  });

  const itens: ItemAPS[] = [];
  for (const l of dados.links) {
    // Links de calendário vêm como "Término de APS 03 - …" e apontam para
    // a MESMA atividade. Removemos o prefixo para reconhecer a APS, mas
    // guardamos o nome canônico sem ele.
    const nome = l.texto.replace(/^(Término|T[eé]rmino|In[ií]cio) de\s+/i, '').trim();
    const m = APS_PATTERN.exec(nome);
    if (!m?.[1]) continue;

    const cm = l.href.match(/[?&]id=(\d+)/);
    const tipo = l.href.match(/\/mod\/([a-z]+)\//)?.[1];
    if (!cm?.[1] || !tipo) continue;

    itens.push({
      cursoId,
      cursoNome: dados.nome,
      numero: Number(m[1]),
      nome,
      cmid: Number(cm[1]),
      tipo,
      url: l.href,
      noIndice: l.origem === 'indice',
      concluida: l.concluida,
    });
  }

  // Dedup por cmid, preferindo a ocorrência vinda do índice lateral
  // (é a que confirma que a atividade está visível no curso).
  const porCmid = new Map<number, ItemAPS>();
  for (const i of itens) {
    const anterior = porCmid.get(i.cmid);
    if (!anterior || (i.noIndice && !anterior.noIndice)) {
      porCmid.set(i.cmid, { ...i, concluida: i.concluida ?? anterior?.concluida ?? null });
    }
  }
  const unicos = [...porCmid.values()].sort((a, b) => a.numero - b.numero);

  const foraDoIndice = unicos.filter((i) => !i.noIndice);
  if (foraDoIndice.length > 0) {
    logger.warn(
      { cursoId, aps: foraDoIndice.map((i) => i.numero) },
      'APS encontrada fora do índice lateral — provavelmente encerrada ou oculta; a triagem decide',
    );
  }

  logger.info(
    { curso: dados.nome.slice(0, 40), cursoId, aps: unicos.length },
    'disciplina varrida',
  );
  return { cursoNome: dados.nome, itens: unicos };
}
