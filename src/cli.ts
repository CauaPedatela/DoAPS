import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from './config/env.ts';
import { launch } from './core/browser.ts';
import { login } from './moodle/auth.ts';
import { listarCursos } from './moodle/courses.ts';
import { varrerAPS, type ItemAPS } from './moodle/sidebar.ts';
import { logger } from './core/logger.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    submit: { type: 'boolean', default: false },
    curso: { type: 'string' },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const comando = positionals[0] ?? 'scan';

if (values.help) {
  console.log(`
doAPS — automação de APS no AVA (Moodle)

  npm start -- scan              lista todas as APS das suas disciplinas
  npm start -- scan --curso 16459
  npm start -- scan --json runs/aps.json

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

if (comando !== 'scan') {
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

  const todas: ItemAPS[] = [];
  for (const c of alvos) {
    const { itens } = await varrerAPS(page, cfg, c.id);
    todas.push(...itens);
  }

  const porCurso = new Map<string, ItemAPS[]>();
  for (const a of todas) {
    porCurso.set(a.cursoNome, [...(porCurso.get(a.cursoNome) ?? []), a]);
  }

  console.log(`\n${todas.length} APS em ${porCurso.size} disciplinas\n`);
  for (const [curso, itens] of porCurso) {
    console.log(`  ${curso}`);
    for (const i of itens) {
      console.log(`     APS ${String(i.numero).padStart(2, '0')}  ${i.tipo}  cmid=${i.cmid}`);
    }
  }

  if (values.json) {
    await mkdir(dirname(values.json), { recursive: true });
    await writeFile(values.json, JSON.stringify(todas, null, 2), 'utf8');
    console.log(`\nsalvo em ${values.json}`);
  }
} catch (err) {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'falhou');
  process.exitCode = 1;
} finally {
  await sessao.close();
}
