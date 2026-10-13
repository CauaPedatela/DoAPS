/**
 * Painel local do doAPS.
 *
 * Um servidor HTTP mínimo (node:http, sem framework) que serve uma página
 * com campos de login e um botão, e transmite o progresso da execução ao
 * vivo por Server-Sent Events.
 *
 * SEGURANÇA — três decisões deliberadas:
 *
 * 1. Escuta apenas em 127.0.0.1. Nunca fica acessível pela rede local,
 *    nem pelo wi-fi da faculdade.
 * 2. Valida o cabeçalho `Host`. Sem isso, um site malicioso aberto no mesmo
 *    navegador poderia apontar um domínio para 127.0.0.1 (DNS rebinding) e
 *    conversar com este servidor.
 * 3. As credenciais ficam em MEMÓRIA, só durante a execução. Nada é
 *    gravado em disco a menos que você marque "lembrar", e aí vai para o
 *    .env, que está no .gitignore.
 *
 *   npm run ui
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, recarregarEnv } from '../config/env.ts';
import { varrerEExecutar } from '../runner/varredura.ts';
import { assinar, publicar, progresso } from '../core/eventos.ts';
import { STATE_PATH } from '../core/browser.ts';
import { logger } from '../core/logger.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env['UI_PORT'] ?? 4321);

/** Só uma execução por vez: duas sessões do navegador brigariam pelo login. */
let rodando = false;

type Pedido = {
  usuario?: string;
  senha?: string;
  enviar?: boolean;
  cmid?: string;
  forcar?: boolean;
  lembrar?: boolean;
};

function hostLocal(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

async function corpo(req: IncomingMessage): Promise<Pedido> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += (p as Buffer).length;
    if (tamanho > 64 * 1024) throw new Error('corpo grande demais');
    partes.push(p as Buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') as Pedido;
}

async function executar(p: Pedido): Promise<void> {
  recarregarEnv();

  // As credenciais vêm SEMPRE do formulário, nunca do .env.
  //
  // A primeira versão usava `...(p.usuario ? {...} : {})`: campo vazio é
  // falsy, então caía silenciosamente nas credenciais do .env. Enviar o
  // formulário em branco disparava uma execução real na conta salva — foi
  // o que aconteceu num teste. Botão que faz algo diferente do que o
  // formulário mostra é pior que botão que não funciona.
  const cfg = loadConfig({
    ...process.env,
    MOODLE_USERNAME: p.usuario,
    MOODLE_PASSWORD: p.senha,
  });

  // A sessão salva pertence a UM usuário. Se alguém entrar com outra
  // conta, reaproveitá-la executaria no aluno errado — então descartamos
  // antes de qualquer execução vinda do painel.
  await rm(STATE_PATH, { force: true });

  if (p.lembrar && p.usuario && p.senha) {
    const texto = await readFile('.env', 'utf8');
    await writeFile(
      '.env',
      texto
        .replace(/^MOODLE_USERNAME=.*$/m, `MOODLE_USERNAME=${p.usuario}`)
        .replace(/^MOODLE_PASSWORD=.*$/m, `MOODLE_PASSWORD=${p.senha}`),
      'utf8',
    );
    progresso('   credenciais salvas no .env (fora do git)');
  }

  progresso(p.enviar ? '▶ Executando e ENVIANDO' : '▶ Executando — preenche, não envia', true);

  const r = await varrerEExecutar(cfg, {
    submeter: Boolean(p.enviar),
    ...(p.cmid ? { cmid: Number(p.cmid) } : {}),
    forcar: Boolean(p.forcar),
  });

  publicar({ tipo: 'fim', ok: true, resumo: r });
}

const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!hostLocal(req)) {
    res.writeHead(403).end('apenas local');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/' && req.method === 'GET') {
    const html = await readFile(join(AQUI, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    return;
  }

  // Fluxo de eventos: a página escuta aqui e vai desenhando o progresso.
  if (url.pathname === '/api/eventos' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ tipo: 'linha', texto: 'conectado' })}\n\n`);
    const cancelar = assinar((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      cancelar();
    });
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rodando }));
    return;
  }

  if (url.pathname === '/api/executar' && req.method === 'POST') {
    if (rodando) {
      res.writeHead(409, { 'content-type': 'application/json' })
        .end(JSON.stringify({ erro: 'já há uma execução em andamento' }));
      return;
    }
    let p: Pedido;
    try {
      p = await corpo(req);
    } catch {
      res.writeHead(400).end('pedido inválido');
      return;
    }

    if (!p.usuario?.trim() || !p.senha) {
      res.writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ erro: 'usuário e senha são obrigatórios' }));
      return;
    }

    rodando = true;
    res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));

    // Responde na hora e segue executando: a execução leva minutos e o
    // progresso vai pelo canal de eventos, não por esta resposta.
    executar(p)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ err: msg }, 'execução pelo painel falhou');
        publicar({ tipo: 'erro', texto: msg });
        publicar({ tipo: 'fim', ok: false });
      })
      .finally(() => {
        rodando = false;
      });
    return;
  }

  res.writeHead(404).end('não encontrado');
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  doAPS — painel local`);
  console.log(`  http://127.0.0.1:${PORTA}\n`);
  console.log('  Escutando apenas em 127.0.0.1 — inacessível pela rede.');
  console.log('  Ctrl+C para encerrar.\n');
});
