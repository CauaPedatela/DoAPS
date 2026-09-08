/**
 * Avaliação contra APS já corrigidas.
 *
 * Usa páginas de REVISÃO de tentativas finalizadas: são somente leitura,
 * não consomem tentativa, e trazem o gabarito. É a única forma honesta de
 * medir a IA — comparar com a resposta certa, não com a confiança que ela
 * mesma declara.
 *
 *   npm run eval
 */
import { loadConfig, recarregarEnv } from '../src/config/env.ts';
import { launch } from '../src/core/browser.ts';
import { login } from '../src/moodle/auth.ts';
import { extrairQuestoes } from '../src/extraction/extract.ts';
import { prepararLote } from '../src/extraction/images.ts';
import { criarSolver } from '../src/ai/providers/index.ts';

const ALVOS = [
  { nome: 'ARQUITETURA APS 2', url: 'https://avagrad.unievangelica.edu.br/mod/quiz/review.php?attempt=6474664&cmid=2886254' },
  { nome: 'PESQ.OPERACIONAL APS 4', url: 'https://avagrad.unievangelica.edu.br/mod/quiz/review.php?attempt=6478415&cmid=2942445' },
];

recarregarEnv();
const cfg = loadConfig();
const solver = criarSolver(cfg);
const s = await launch(cfg);
let totalQ = 0, totalAcertos = 0, totalComImg = 0, acertosComImg = 0;

try {
  const page = await login(s.context, cfg);

  for (const alvo of ALVOS) {
    await page.goto(alvo.url + '&showall=1', { waitUntil: 'networkidle', timeout: 90_000 });
    await page.locator('div.que').first().waitFor({ state: 'attached', timeout: 30_000 });

    // Gabarito: o Moodle mostra "A resposta correta é: <texto>" em .rightanswer.
    // Fica FORA de .qtext e .answer, então a extração não o enxerga.
    // Em algumas APS a alternativa é uma IMAGEM sem texto nenhum — foi o
    // caso de Pesquisa Operacional APS 4, com 4 imagens por questão. Aí o
    // gabarito também é uma imagem, e a comparação tem de ser pela URL.
    const gabarito = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div.que')).map((d) => {
        const ra = d.querySelector('.rightanswer');
        return {
          certa: (ra?.textContent ?? '')
            .replace(/\s+/g, ' ').replace(/^A resposta correta é:\s*/i, '').trim(),
          certaImg: ra?.querySelector('img')?.getAttribute('src') ?? null,
          estado: Array.from(d.classList).find((c) => /^correct|^incorrect|partiallycorrect/.test(c)) ?? '?',
        };
      }),
    );

    const questoes = await extrairQuestoes(page);
    const urls = questoes.flatMap((q) => [
      ...q.imagens,
      ...q.alternativas.map((a) => a.imagem).filter((u): u is string => Boolean(u)),
    ]);
    const imgs = urls.length > 0 ? await prepararLote(page.request, urls) : undefined;

    const r = await solver.resolver(questoes, imgs);
    const porSlot = new Map(r.respostas.map((x) => [x.n, x]));

    console.log(`\n══ ${alvo.nome} ══  ${questoes.length} questões · ${imgs?.size ?? 0} imagens`);
    questoes.forEach((q, i) => {
      const resp = porSlot.get(q.slot);
      const escolhida = q.alternativas.find((a) => a.letra === (resp?.a ?? '').trim().toUpperCase().slice(0, 1));
      const g = gabarito[i];
      const certa = g?.certa ?? '';
      // Nunca comparar por LETRA: o Moodle embaralha a ordem. Compara pelo
      // conteúdo — texto quando existe, URL da imagem quando a alternativa
      // é só figura.
      const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
      const acertou = Boolean(
        escolhida &&
          (g?.certaImg && escolhida.imagem
            ? escolhida.imagem.endsWith(g.certaImg.split('/').slice(-3).join('/'))
            : certa && norm(escolhida.texto).length > 3 && norm(certa).includes(norm(escolhida.texto).slice(0, 40))),
      );
      const comImg = q.imagens.length > 0 || q.alternativas.some((a) => a.imagem);

      totalQ++; if (acertou) totalAcertos++;
      if (comImg) { totalComImg++; if (acertou) acertosComImg++; }

      console.log(
        `  ${acertou ? '✓' : '✗'} q${String(q.slot).padStart(2)}${comImg ? ' 🖼' : '  '} ` +
          `IA=${(resp?.a ?? '—').padEnd(3)} (${resp?.conf ?? '—'})  ${escolhida?.texto.slice(0, 42) ?? ''}`,
      );
      if (!acertou) {
        const alvo = g?.certaImg ? 'imagem ...' + g.certaImg.slice(-28) : certa.slice(0, 60);
        console.log(`        correta: ${alvo || '(gabarito indisponível)'}`);
        if (escolhida?.imagem) console.log(`        escolheu: imagem ...${escolhida.imagem.slice(-28)}`);
      }
    });
    console.log(`  tokens: ${r.uso.entrada} entrada / ${r.uso.saida} saída`);
  }

  console.log('\n════ RESULTADO ════');
  console.log(`  geral          : ${totalAcertos}/${totalQ}  (${((totalAcertos/totalQ)*100).toFixed(0)}%)`);
  console.log(`  COM imagem     : ${acertosComImg}/${totalComImg}` + (totalComImg ? `  (${((acertosComImg/totalComImg)*100).toFixed(0)}%)` : ''));
  console.log(`  sem imagem     : ${totalAcertos-acertosComImg}/${totalQ-totalComImg}`);
} finally {
  await s.close();
}
