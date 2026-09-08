/**
 * Agendador do doAPS.
 *
 * Fica aberto e dispara a varredura no horário configurado, todo dia.
 * Feito para rodar dentro do IntelliJ com o navegador visível — é o
 * modo em que dá para acompanhar as páginas passando.
 *
 *   npm run daemon              dispara no horário de DAEMON_HORA
 *   npm run daemon -- --agora   dispara UMA vez já, depois segue no horário
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './config/env.ts';
import { varrerEExecutar } from './runner/varredura.ts';
import { logger } from './core/logger.ts';
import { proximaExecucao, formatarEspera } from './core/agenda.ts';

const { values } = parseArgs({
  options: {
    agora: { type: 'boolean', default: false },
    'uma-vez': { type: 'boolean', default: false },
  },
});

const cfg = loadConfig();


async function ciclo(): Promise<void> {
  const inicio = Date.now();
  logger.info(
    { submeter: cfg.DAEMON_SUBMIT, ultimaTentativa: cfg.DAEMON_ULTIMA_TENTATIVA },
    '=== iniciando varredura agendada ===',
  );

  const r = await varrerEExecutar(cfg, {
    submeter: cfg.DAEMON_SUBMIT,
    permitirUltimaTentativa: cfg.DAEMON_ULTIMA_TENTATIVA,
  });

  console.log('\n┌─ RESULTADO DA VARREDURA ' + '─'.repeat(34));
  console.log(`│ pendentes encontradas : ${r.pendentes}`);
  console.log(`│ executadas            : ${r.executadas.length}`);
  for (const e of r.executadas) {
    console.log(
      `│   ✓ ${e.aps.slice(0, 34).padEnd(34)} ${e.preenchidas}/${e.questoes}` +
        `  ${e.enviado ? 'ENVIADA' : 'preenchida, não enviada'}`,
    );
    if (e.baixaConfianca.length > 0) {
      console.log(`│     ⚠ revisar questões: ${e.baixaConfianca.map((b) => b.slot).join(', ')}`);
    }
  }
  console.log(`│ puladas               : ${r.puladas.length}`);
  for (const p of r.puladas) {
    console.log(`│   · APS ${String(p.numero).padStart(2, '0')} ${p.curso.slice(0, 26).padEnd(26)} ${p.motivo.slice(0, 46)}`);
  }
  console.log(`└─ ${Math.round((Date.now() - inicio) / 1000)}s ` + '─'.repeat(46) + '\n');
}

async function main(): Promise<void> {
  console.log('doAPS — agendador ativo');
  console.log(`  horário   : ${cfg.DAEMON_HORA} (fuso local da máquina)`);
  console.log(`  enviar    : ${cfg.DAEMON_SUBMIT ? 'SIM — envia de fato' : 'não (preenche e deixa aberta)'}`);
  console.log(`  tent.única: ${cfg.DAEMON_ULTIMA_TENTATIVA ? 'inclui APS de tentativa única' : 'PULA APS de tentativa única'}`);
  console.log(`  navegador : ${cfg.HEADED ? 'visível' : 'oculto'}\n`);

  if (values.agora) {
    await ciclo().catch((e) => logger.error({ err: String(e) }, 'ciclo falhou'));
    if (values['uma-vez']) return;
  }

  // Laço perpétuo: recalcula o alvo a cada volta, então continua correto
  // mesmo se a máquina dormir ou o relógio for ajustado no meio.
  for (;;) {
    const alvo = proximaExecucao(cfg.DAEMON_HORA);
    const espera = alvo.getTime() - Date.now();
    logger.info(
      { proxima: alvo.toLocaleString('pt-BR'), em: formatarEspera(espera) },
      'aguardando próxima execução',
    );
    await new Promise((r) => setTimeout(r, espera));

    // Um erro num dia não pode derrubar o agendador.
    await ciclo().catch((e) => logger.error({ err: String(e) }, 'ciclo falhou — segue agendado'));
  }
}

await main();
