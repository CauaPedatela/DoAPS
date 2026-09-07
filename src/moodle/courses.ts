import type { Page } from 'playwright';
import type { Config } from '../config/env.ts';
import { PATHS } from '../config/selectors.ts';
import { logger } from '../core/logger.ts';

export type Curso = { id: number; nome: string };

/**
 * Lista as disciplinas em /my/courses.php.
 *
 * Só o id é extraído aqui. O nome vem depois, do <h1> da própria página do
 * curso: os cards embutem texto de leitor de tela ("Curso é favorito",
 * "Nome da disciplina") que contamina qualquer leitura por textContent.
 */
export async function listarCursos(page: Page, cfg: Config): Promise<Curso[]> {
  await page.goto(cfg.MOODLE_URL + PATHS.myCourses, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  const cursos = await page.evaluate(() => {
    const porId = new Map<number, string>();
    for (const a of Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/course/view.php?id="]'),
    )) {
      const m = a.href.match(/[?&]id=(\d+)/);
      if (!m?.[1]) continue;
      const id = Number(m[1]);
      const txt = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      const atual = porId.get(id) ?? '';
      if (txt.length > atual.length) porId.set(id, txt);
    }
    return Array.from(porId, ([id, nome]) => ({ id, nome }));
  });

  logger.info({ total: cursos.length }, 'disciplinas encontradas');
  return cursos;
}
