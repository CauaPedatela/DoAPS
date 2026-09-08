/**
 * Agendador do doAPS.
 *
 * Fica aberto e dispara a varredura no horário configurado, todo dia.
 * Feito para rodar dentro do IntelliJ com o navegador visível — é o
 * modo em que dá para acompanhar as páginas passando.
 *
 *   npm run daemon                 executa JÁ e depois entra no loop diário
 *   npm run daemon -- --so-agendar pula a execução inicial, só agenda
 *   npm run daemon -- --uma-vez    executa uma vez e encerra
 */
import { parseArgs } from 'node:util';
import { loadConfig, recarregarEnv } from './config/env.ts';
import { varrerEExecutar } from './runner/varredura.ts';
import { logger } from './core/logger.ts';
import { proximaExecucao, formatarEspera } from './core/agenda.ts';

const { values } = parseArgs({
  options: {
    /** Pula a execução inicial e vai direto para a espera. */
    'so-agendar': { type: 'boolean', default: false },
    /** Executa uma vez e encerra, sem entrar no loop. */
    'uma-vez': { type: 'boolean', default: false },
  },
});

const cfg = loadConfig();


async function ciclo(): Promise<void> {
  const inicio = Date.now();

  // Relê o .env a cada ciclo: o agendador fica aberto por dias, e sem isto
  // qualquer ajuste (MIN_QUIZ_MINUTES, DAEMON_SUBMIT, horário) exigiria
  // reiniciar — o que, no meio de uma APS, deixaria a tentativa aberta.
  recarregarEnv();
  const cfg = loadConfig();

  logger.info(
    { submeter: cfg.DAEMON_SUBMIT, pisoMin: cfg.MIN_QUIZ_MINUTES },
    '=== iniciando varredura ===',
  );

  const r = await varrerEExecutar(cfg, {
    submeter: cfg.DAEMON_SUBMIT,
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
  console.log('\ndoAPS');
  console.log(`  horário diário : ${cfg.DAEMON_HORA} (fuso local da máquina)`);
  console.log(`  regra          : só APS sem nenhuma tentativa feita`);
  console.log(`  navegador      : ${cfg.HEADED ? 'visível' : 'oculto'}`);
  console.log(
    `  envio          : ${
      cfg.DAEMON_SUBMIT
        ? 'AUTOMÁTICO — as APS serão ENVIADAS, sem revisão'
        : 'não envia (preenche e deixa aberta para você revisar)'
    }`,
  );

  if (cfg.DAEMON_SUBMIT) {
    // Envio é irreversível e vale nota. Um aviso visível de dois segundos
    // custa pouco e dá chance de abortar com Ctrl+C quem ligou a flag sem
    // perceber o que ela faz.
    console.log('\n  ⚠  DAEMON_SUBMIT=true — cada APS executada será enviada de vez.');
    console.log('     Ctrl+C agora para abortar.\n');
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Execução imediata ao subir: é o momento em que você está olhando.
  // Só depois entra no laço diário.
  if (!values['so-agendar']) {
    console.log('▶  Executando agora — acompanhe o navegador.\n');
    await ciclo().catch((e) => logger.error({ err: String(e) }, 'ciclo inicial falhou'));
    if (values['uma-vez']) return;
  }

  // Laço perpétuo: recalcula o alvo a cada volta, então continua correto
  // mesmo se a máquina dormir ou o relógio for ajustado no meio.
  for (;;) {
    // Relê também aqui: mudar DAEMON_HORA no .env passa a valer na
    // próxima volta, sem reiniciar.
    recarregarEnv();
    const alvo = proximaExecucao(loadConfig().DAEMON_HORA);
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
