import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from './config/env.ts';
import { launch } from './core/browser.ts';
import { login } from './moodle/auth.ts';
import { listarCursos } from './moodle/courses.ts';
import { varrerAPS, type ItemAPS } from './moodle/sidebar.ts';
import { triar, avaliar } from './moodle/triage.ts';
import { logger } from './core/logger.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    submit: { type: 'boolean', default: false },
    curso: { type: 'string' },
    /** Mira uma APS específica pelo cmid — para testes pontuais. */
    cmid: { type: 'string' },
    /** Por padrão só mostra pendentes (regra: não mexer no que já está feito). */
    todas: { type: 'boolean', default: false },
    /** Libera abrir uma APS que tem só 1 tentativa restante. Irreversível. */
    'ultima-tentativa': { type: 'boolean', default: false },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const comando = positionals[0] ?? 'scan';

if (values.help) {
  console.log(`
doAPS — automação de APS no AVA (Moodle)

  npm start -- scan                      APS PENDENTES de todas as disciplinas
  npm start -- scan --todas              inclui as já concluídas
  npm start -- scan --curso 16459        uma disciplina
  npm start -- scan --cmid 2886266       uma APS específica
  npm start -- scan --json runs/aps.json

  npm start -- triage                    lê prazo e tentativas de cada pendente
  npm start -- triage --cmid 2886512     triagem de uma APS específica

O comando triage é SOMENTE LEITURA: não inicia tentativa, não consome nada.

Legenda de conclusão:  ● feita   ○ pendente   ? sem rastreamento

Flags de segurança:
  --dry-run   preenche mas NÃO envia (padrão de trabalho)
  --submit    envia de fato — opt-in explícito
  --offline   roda contra fixtures, sem navegador nem tentativa
`);
  process.exit(0);
}

if (values.submit && values['dry-run']) {
  console.error('--submit e --dry-run são mutuamente exclusivos.');
  process.exit(1);
}

const cfg = loadConfig();

if (comando !== 'scan' && comando !== 'triage') {
  console.error(`Comando desconhecido: ${comando}. Use --help.`);
  process.exit(1);
}

const sessao = await launch(cfg);
try {
  const page = await login(sessao.context, cfg);
  await sessao.save();

  const alvos = values.curso
    ? [{ id: Number(values.curso), nome: '' }]
    : await listarCursos(page, cfg);

  const encontradas: ItemAPS[] = [];
  for (const c of alvos) {
    const { itens } = await varrerAPS(page, cfg, c.id);
    encontradas.push(...itens);
  }

  const alvoCmid = values.cmid ? Number(values.cmid) : undefined;

  // Regra: por padrão só interessam as APS não concluídas. `concluida:null`
  // (curso sem rastreamento) permanece na lista — não dá para afirmar que
  // está feita, e descartar em silêncio seria pior do que mostrar a mais.
  const filtradas = encontradas
    .filter((a) => alvoCmid === undefined || a.cmid === alvoCmid)
    .filter((a) => values.todas || a.concluida !== true);

  const marca = (c: boolean | null): string => (c === true ? '●' : c === false ? '○' : '?');

  const porCurso = new Map<string, ItemAPS[]>();
  for (const a of filtradas) {
    porCurso.set(a.cursoNome, [...(porCurso.get(a.cursoNome) ?? []), a]);
  }

  const ocultas = encontradas.length - filtradas.length;
  console.log(
    `\n${filtradas.length} APS${values.todas ? '' : ' pendentes'} em ${porCurso.size} disciplinas` +
      (ocultas > 0 ? `  (${ocultas} já concluídas, ocultas — use --todas)` : ''),
  );
  console.log('legenda: ● feita   ○ pendente   ? sem rastreamento\n');

  for (const [curso, itens] of porCurso) {
    console.log(`  ${curso}`);
    for (const i of itens) {
      const flags = [i.noIndice ? '' : 'fora-do-índice'].filter(Boolean).join(' ');
      console.log(
        `    ${marca(i.concluida)} APS ${String(i.numero).padStart(2, '0')}  ` +
          `${i.tipo}  cmid=${i.cmid}${flags ? '  ' + flags : ''}`,
      );
    }
  }

  // ─── triagem: lê a página de cada quiz (somente leitura) ─────────────
  const relatorio: unknown[] = [];
  if (comando === 'triage') {
    console.log('\n─── TRIAGEM (somente leitura, não consome tentativa) ───\n');
    for (const item of filtradas) {
      const t = await triar(page, cfg, item);
      const v = avaliar(t, cfg, { permitirUltimaTentativa: values['ultima-tentativa'] });
      const prazo = t.fechaEm ? t.fechaEm.toLocaleString('pt-BR') : '—';

      console.log(`  ${v.ok ? '✓' : '·'} APS ${String(item.numero).padStart(2, '0')}  ${item.cursoNome.slice(0, 30)}`);
      console.log(`      cmid=${item.cmid}  tentativas=${t.tentativasUsadas}/${t.tentativasPermitidas ?? '?'}  fecha=${prazo}  duração=${t.duracaoMaxMin ?? '?'}min`);
      console.log(`      → ${v.motivo}\n`);
      relatorio.push({ ...item, triagem: t, veredito: v });
    }
    const aptas = relatorio.filter((r) => (r as { veredito: { ok: boolean } }).veredito.ok).length;
    console.log(`${aptas} de ${filtradas.length} aptas a rodar agora.`);
    if (aptas === 0 && !values['ultima-tentativa']) {
      console.log('Se todas têm tentativa única, use --ultima-tentativa para liberar.');
    }
  }

  if (values.json) {
    await mkdir(dirname(values.json), { recursive: true });
    const saida = comando === 'triage' ? relatorio : filtradas;
    await writeFile(values.json, JSON.stringify(saida, null, 2), 'utf8');
    console.log(`\nsalvo em ${values.json}`);
  }
} catch (err) {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'falhou');
  process.exitCode = 1;
} finally {
  await sessao.close();
}
