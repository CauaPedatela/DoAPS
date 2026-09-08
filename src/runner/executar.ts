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
  enviarTentativa,
  confirmarEnvio,
} from '../moodle/attempt.ts';
import { extrairQuestoes } from '../extraction/extract.ts';
import { prepararLote } from '../extraction/images.ts';
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
    console.log(`   [1/4] lendo ${paginas} página(s)…`);

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
    console.log(`   [2/4] resolvendo ${todas.length} questão(ões) com a IA…`);

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
      // Imagens exigem a sessão autenticada (pluginfile.php recusa acesso
      // anônimo), por isso o download usa o contexto do próprio navegador.
      const urls = faltando.flatMap((q) => [
        ...q.imagens,
        ...q.alternativas.map((a) => a.imagem).filter((u): u is string => Boolean(u)),
      ]);
      const imgs = urls.length > 0 ? await prepararLote(page.request, urls) : undefined;
      if (imgs && imgs.size > 0) console.log(`   ↳ ${imgs.size} imagem(ns) anexada(s)`);

      const r = await solver.resolver(faltando, imgs);
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

    console.log('   [3/4] preenchendo…');
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

    // O piso de tempo é uma espera longa e parada na tela de resumo. Sem
    // avisar ANTES, ela é indistinguível de um travamento — quem está
    // assistindo não tem como saber que o programa está funcionando.
    const faltaPiso = cfg.MIN_QUIZ_MINUTES * 60_000 - (Date.now() - t0);
    if (faltaPiso > 0) {
      const seg = Math.round(faltaPiso / 1000);
      console.log(
        `   ⏳ aguardando ${Math.floor(seg / 60)}min${String(seg % 60).padStart(2, '0')}s ` +
          `para o piso de ${cfg.MIN_QUIZ_MINUTES}min (MIN_QUIZ_MINUTES) — não está travado`,
      );
      logger.info(
        { faltaSegundos: seg, pisoMinutos: cfg.MIN_QUIZ_MINUTES },
        'aguardando piso de tempo antes de enviar',
      );
    }
    const esperou = await enforceFloor(t0, cfg.MIN_QUIZ_MINUTES * 60_000);
    if (esperou > 0) logger.info({ esperouMs: esperou }, 'piso de tempo cumprido');

    let enviado = false;
    if (opts.submeter) {
      console.log('   [4/4] enviando…');
      await enviarTentativa(page, cfg, attempt, item.cmid);
      const c = await confirmarEnvio(page, cfg, item.cmid);
      enviado = c.finalizada;
      console.log(
        `   ${c.finalizada ? '✓ ENVIADA' : '⚠ enviou mas o Moodle não confirmou'}` +
          `${c.nota ? ` · nota ${c.nota}` : ''}`,
      );
      logger.warn({ finalizada: c.finalizada, nota: c.nota }, 'tentativa enviada');
    }

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
      enviado,
      segundos: Math.round((Date.now() - t0) / 1000),
    };
  } finally {
    cache.fechar();
  }
}
