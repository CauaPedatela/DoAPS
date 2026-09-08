/**
 * Boletim: situação e nota de cada APS, lido do Moodle.
 *
 * Somente leitura. Serve para medir a qualidade real das respostas da IA
 * — o relatório de execução diz o que foi enviado, não quanto valeu.
 *
 *   npm run notas
 */
import { loadConfig, recarregarEnv } from '../config/env.ts';
import { launch } from './browser.ts';
import { login } from '../moodle/auth.ts';
import { listarCursos } from '../moodle/courses.ts';
import { varrerAPS } from '../moodle/sidebar.ts';
import { PATHS } from '../config/selectors.ts';

type Linha = {
  curso: string;
  numero: number;
  cmid: number;
  tentativa: number;
  situacao: string;
  nota: string | null;
  percentual: number | null;
  concluido: string | null;
};

recarregarEnv();
const cfg = loadConfig();
const sessao = await launch(cfg);

try {
  const page = await login(sessao.context, cfg);
  const cursos = await listarCursos(page, cfg);

  const linhas: Linha[] = [];
  for (const c of cursos) {
    const { itens } = await varrerAPS(page, cfg, c.id);
    for (const item of itens) {
      await page.goto(cfg.MOODLE_URL + PATHS.quizView(item.cmid), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      // Uma APS pode ter VÁRIAS tentativas, cada uma no seu próprio bloco
      // "Resumo da tentativa N". Pegar só o primeiro "Notas" da página
      // atribui ao robô uma nota que pode ser sua — foi o que aconteceu em
      // Pesquisa Operacional APS 01, onde a tentativa 1 era do usuário e a
      // 2 (do robô) estava aberta e nunca enviada.
      const blocos = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table'))
          .map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter((t) => /Resumo da tentativa/i.test(t)),
      );

      if (blocos.length === 0) {
        linhas.push({
          curso: item.cursoNome, numero: item.numero, cmid: item.cmid, tentativa: 1,
          situacao: 'sem tentativa', nota: null, percentual: null, concluido: null,
        });
        continue;
      }

      for (const b of blocos) {
        const n = b.match(/Resumo da tentativa\s+(\d+)/i)?.[1];
        const finalizada = /Situa[çc][ãa]o\s+Finalizada/i.test(b);
        const aberta = /Nunca enviadas|Em andamento/i.test(b);
        const nota = b.match(/Notas?\s+([\d,.]+\s*\/\s*[\d,.]+)/i)?.[1] ?? null;
        const pct = b.match(/\((\d+(?:[,.]\d+)?)%\)/)?.[1];
        const concluido = b.match(/Conclu[íi]do\s+(.{0,40}?)(?=\s+Dura|$)/i)?.[1];

        linhas.push({
          curso: item.cursoNome,
          numero: item.numero,
          cmid: item.cmid,
          tentativa: n ? Number(n) : 1,
          situacao: finalizada ? 'Finalizada' : aberta ? 'ABERTA (nunca enviada)' : '?',
          nota,
          percentual: pct ? Number(pct.replace(',', '.')) : null,
          concluido: concluido?.trim() ?? null,
        });
      }
    }
  }

  const feitas = linhas.filter((l) => l.situacao === "Finalizada");
  const porCurso = new Map<string, Linha[]>();
  for (const l of linhas) porCurso.set(l.curso, [...(porCurso.get(l.curso) ?? []), l]);

  console.log('\n════ BOLETIM DAS APS ════\n');
  for (const [curso, itens] of porCurso) {
    console.log(`  ${curso}`);
    for (const l of itens.sort((a, b) => a.numero - b.numero)) {
      const aberta = l.situacao.startsWith('ABERTA');
      const marca = l.situacao === 'Finalizada' ? '✓' : aberta ? '◐' : '·';
      const pct = l.percentual !== null ? `${String(l.percentual).padStart(5)}%` : '     —';
      const tent = l.tentativa > 1 ? ` (tent.${l.tentativa})` : '         ';
      console.log(
        `    ${marca} APS ${String(l.numero).padStart(2, '0')}${tent}  ${pct}  ` +
          `${(l.nota ?? '—').padEnd(14)} ${aberta ? '⚠ ABERTA, nunca enviada' : (l.concluido ?? '')}`,
      );
    }
    console.log();
  }

  const comPct = feitas.filter((l) => l.percentual !== null);
  if (comPct.length > 0) {
    const media = comPct.reduce((s, l) => s + (l.percentual ?? 0), 0) / comPct.length;
    const cem = comPct.filter((l) => l.percentual === 100).length;
    console.log('════ RESUMO ════');
    console.log(`  finalizadas    : ${feitas.length}`);
    console.log(`  média          : ${media.toFixed(1)}%`);
    console.log(`  notas 100%     : ${cem} de ${comPct.length}`);
    const piores = [...comPct].sort((a, b) => (a.percentual ?? 0) - (b.percentual ?? 0)).slice(0, 3);
    if (piores[0] && (piores[0].percentual ?? 100) < 100) {
      console.log('  abaixo de 100% :');
      for (const p of piores.filter((x) => (x.percentual ?? 100) < 100)) {
        console.log(`     APS ${p.numero} ${p.curso.slice(0, 30)} → ${p.percentual}%`);
      }
    }
  }
} finally {
  await sessao.close();
}
