import type { Page } from 'playwright';
import type { Config } from '../config/env.ts';
import type { ItemAPS } from '../moodle/sidebar.ts';
import {
  abrirTentativa,
  salvarFixture,
  irParaPagina,
  contarPaginas,
  aguardarQuestoes,
  avancarSubmetendo,
} from '../moodle/attempt.ts';
import { extrairQuestoes } from '../extraction/extract.ts';
import { preencher, type ResultadoPreenchimento } from '../filling/index.ts';
import { criarSolver } from '../ai/providers/index.ts';
import { CacheRespostas } from '../ai/cache.ts';
import type { Questao, Resposta, Uso } from '../ai/types.ts';
import { logger } from '../core/logger.ts';
import { enforceFloor, pause, readingTime } from '../core/humanize.ts';

export type Relatorio = {
  cmid: number;
  aps: string;
  attempt: number;
  paginas: number;
  questoes: number;
  preenchidas: number;
  baixaConfianca: Array<{ slot: number; resposta: string }>;
  falhas: ResultadoPreenchimento[];
  uso: Uso;
  cacheAcertos: number;
  chamadasIA: number;
  enviado: boolean;
  segundos: number;
};

/**
 * Executa uma APS em três passos.
 *
 * Este quiz tem 10 páginas com 1 questão cada. Resolver página a página
 * seria 1 chamada de IA por questão — 10 vezes o mesmo system prompt.
 * Coletamos tudo primeiro, resolvemos em UMA chamada e depois voltamos
 * preenchendo. De quebra, o padrão de navegação (ler tudo, depois
 * responder) é o que um aluno faria.
 */
export async function executarAPS(
  page: Page,
  cfg: Config,
  item: ItemAPS,
  opts: { submeter: boolean },
): Promise<Relatorio> {
  const t0 = Date.now();
  const solver = criarSolver(cfg);
  const cache = new CacheRespostas();

  try {
    const attempt = await abrirTentativa(page, cfg, item.cmid);
    await aguardarQuestoes(page);
    const paginas = await contarPaginas(page);
    logger.info({ attempt, paginas }, 'tentativa aberta');

    // ─── passo 1: percorrer e coletar ──────────────────────────────────
    // Navega EXPLICITAMENTE para cada página, inclusive a 0. Ao retomar
    // uma tentativa o Moodle abre na última página visitada, não na
    // primeira — confiar em onde abrirTentativa caiu fazia a página 0
    // ser catalogada com a questão errada, e o preenchimento depois
    // procurava um domId inexistente naquela página.
    const porPagina = new Map<number, Questao[]>();
    for (let p = 0; p < paginas; p++) {
      const achadas = await irParaPagina(page, cfg, attempt, item.cmid, p);
      await salvarFixture(page, `aps-${item.cmid}-p${p}`);
      if (achadas === 0) {
        logger.warn({ pagina: p }, 'página sem questões');
        continue;
      }
      const qs = await extrairQuestoes(page);
      porPagina.set(p, qs);
      await pause(readingTime(qs.map((q) => q.enunciado).join(' ')) / 3);
    }

    const todas = [...porPagina.values()].flat();
    logger.info({ questoes: todas.length, paginas }, 'coleta concluída');

    // ─── passo 2: resolver — cache primeiro, uma chamada para o resto ──
    const respostas = new Map<number, Resposta>();
    const faltando: Questao[] = [];
    let acertosCache = 0;
    for (const q of todas) {
      const hit = cache.buscar(q.hash, solver.modelo);
      if (hit) {
        respostas.set(q.slot, { ...hit, n: q.slot });
        acertosCache++;
      } else faltando.push(q);
    }

    const uso: Uso = { entrada: 0, saida: 0, cacheadas: 0 };
    let chamadas = 0;
    if (faltando.length > 0) {
      const r = await solver.resolver(faltando);
      chamadas = 1;
      uso.entrada = r.uso.entrada;
      uso.saida = r.uso.saida;
      uso.cacheadas = r.uso.cacheadas;
      for (const resp of r.respostas) {
        respostas.set(resp.n, resp);
        const q = faltando.find((x) => x.slot === resp.n);
        if (q) cache.gravar(q.hash, solver.modelo, resp);
      }
    }

    // ─── passo 3: preencher avançando pelo formulário ──────────────────
    // Começa na página 0 e caminha para frente clicando "Próxima página".
    // NÃO usar page.goto() aqui: o Moodle só grava a resposta quando o
    // form é submetido, e navegar por URL descarta o que foi preenchido.
    const resultados: ResultadoPreenchimento[] = [];
    const baixa: Array<{ slot: number; resposta: string }> = [];

    await irParaPagina(page, cfg, attempt, item.cmid, 0);
    for (let p = 0; p < paginas; p++) {
      await aguardarQuestoes(page);
      for (const q of porPagina.get(p) ?? []) {
        const r = respostas.get(q.slot);
        if (!r) {
          resultados.push({ slot: q.slot, preenchida: false, motivo: 'IA não respondeu este slot' });
          continue;
        }
        if (r.conf === 'baixa') baixa.push({ slot: q.slot, resposta: r.a });
        resultados.push(await preencher(page, q, r));
      }
      // Na última página isto leva ao resumo, que grava sem enviar.
      if (!(await avancarSubmetendo(page))) break;
    }

    const esperou = await enforceFloor(t0, cfg.MIN_QUIZ_MINUTES * 60_000);
    if (esperou > 0) logger.info({ esperouMs: esperou }, 'piso de tempo aplicado');

    if (opts.submeter) logger.warn('envio ainda não implementado — tentativa fica aberta');

    return {
      cmid: item.cmid,
      aps: item.nome,
      attempt,
      paginas,
      questoes: todas.length,
      preenchidas: resultados.filter((r) => r.preenchida).length,
      baixaConfianca: baixa,
      falhas: resultados.filter((r) => !r.preenchida),
      uso,
      cacheAcertos: acertosCache,
      chamadasIA: chamadas,
      enviado: false,
      segundos: Math.round((Date.now() - t0) / 1000),
    };
  } finally {
    cache.fechar();
  }
}
