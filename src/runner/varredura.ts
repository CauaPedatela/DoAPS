import type { Config } from '../config/env.ts';
import { launch } from '../core/browser.ts';
import { login } from '../moodle/auth.ts';
import { listarCursos } from '../moodle/courses.ts';
import { varrerAPS, type ItemAPS } from '../moodle/sidebar.ts';
import { triar, avaliar } from '../moodle/triage.ts';
import { executarAPS, type Relatorio } from './executar.ts';
import { logger } from '../core/logger.ts';

export type OpcoesVarredura = {
  /** Envia de fato. Sem isto, preenche e deixa a tentativa aberta. */
  submeter: boolean;
  /** Restringe a um cmid (útil para teste). */
  cmid?: number;
};

export type ResultadoVarredura = {
  pendentes: number;
  executadas: Relatorio[];
  puladas: Array<{ cmid: number; numero: number; curso: string; motivo: string }>;
};

/**
 * Ciclo completo: entra, varre todas as disciplinas, tria as pendentes e
 * executa as que passarem no portão. É o que o agendador dispara.
 */
export async function varrerEExecutar(
  cfg: Config,
  opts: OpcoesVarredura,
): Promise<ResultadoVarredura> {
  const sessao = await launch(cfg);
  const executadas: Relatorio[] = [];
  const puladas: ResultadoVarredura['puladas'] = [];

  try {
    const page = await login(sessao.context, cfg);
    await sessao.save();

    const cursos = await listarCursos(page, cfg);
    const encontradas: ItemAPS[] = [];
    for (const c of cursos) {
      const { itens } = await varrerAPS(page, cfg, c.id);
      encontradas.push(...itens);
    }

    // Regra: nunca mexer no que já está concluído.
    const pendentes = encontradas
      .filter((a) => opts.cmid === undefined || a.cmid === opts.cmid)
      .filter((a) => a.concluida !== true);

    logger.info({ total: encontradas.length, pendentes: pendentes.length }, 'varredura concluída');

    for (const item of pendentes) {
      const t = await triar(page, cfg, item);
      const v = avaliar(t, cfg);
      if (!v.ok) {
        puladas.push({ cmid: item.cmid, numero: item.numero, curso: item.cursoNome, motivo: v.motivo });
        logger.info({ cmid: item.cmid, aps: item.numero, motivo: v.motivo }, 'APS pulada');
        continue;
      }

      try {
        const rel = await executarAPS(page, cfg, item, { submeter: opts.submeter });
        executadas.push(rel);
      } catch (err) {
        // Uma APS que falha não pode derrubar as outras.
        const motivo = err instanceof Error ? err.message : String(err);
        puladas.push({ cmid: item.cmid, numero: item.numero, curso: item.cursoNome, motivo: `ERRO: ${motivo}` });
        logger.error({ cmid: item.cmid, err: motivo }, 'falha ao executar APS');
      }
    }

    return { pendentes: pendentes.length, executadas, puladas };
  } finally {
    await sessao.close();
  }
}
