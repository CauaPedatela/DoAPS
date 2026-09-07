import type { Page } from 'playwright';
import type { Config } from '../config/env.ts';
import type { ItemAPS } from '../moodle/sidebar.ts';
import {
  abrirTentativa,
  salvarFixture,
  irParaPagina,
  contarPaginas,
  aguardarQuestoes,
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
    const porPagina = new Map<number, Questao[]>();
    for (let p = 0; p < paginas; p++) {
      const achadas = p === 0 ? await aguardarQuestoes(page) : await irParaPagina(page, cfg, attempt, item.cmid, p);
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

    // ─── passo 3: voltar preenchendo ───────────────────────────────────
    const resultados: ResultadoPreenchimento[] = [];
    const baixa: Array<{ slot: number; resposta: string }> = [];
    for (const [p, qs] of porPagina) {
      await irParaPagina(page, cfg, attempt, item.cmid, p);
      for (const q of qs) {
        const r = respostas.get(q.slot);
        if (!r) {
          resultados.push({ slot: q.slot, preenchida: false, motivo: 'IA não respondeu este slot' });
          continue;
        }
        if (r.conf === 'baixa') baixa.push({ slot: q.slot, resposta: r.a });
        resultados.push(await preencher(page, q, r));
      }
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
