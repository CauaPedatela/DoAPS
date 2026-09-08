import type { Page } from 'playwright';
import type { Config } from '../config/env.ts';
import { PATHS } from '../config/selectors.ts';
import { pause } from '../core/humanize.ts';
import type { ItemAPS } from './sidebar.ts';

export type Triagem = {
  cmid: number;
  titulo: string;
  tentativasPermitidas: number | null;
  tentativasUsadas: number;
  tentativasRestantes: number | null;
  abreEm: Date | null;
  fechaEm: Date | null;
  duracaoMaxMin: number | null;
  /** Há um formulário de iniciar tentativa disponível agora? */
  podeIniciar: boolean;
  /** Existe tentativa em andamento a retomar? */
  emAndamento: boolean;
};

const MESES: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/** "domingo, 13 set. 2026, 23:59" → Date */
export function parseDataMoodle(txt: string): Date | null {
  const m = txt.match(/(\d{1,2})\s+([a-zç]{3})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const [, d, mesTxt, ano, h, min] = m;
  const mes = MESES[(mesTxt ?? '').toLowerCase().slice(0, 3)];
  if (mes === undefined) return null;
  return new Date(Number(ano), mes, Number(d), Number(h), Number(min));
}

/** "1 hora 40 minutos" / "45 minutos" → minutos */
export function parseDuracao(txt: string): number | null {
  const h = txt.match(/(\d+)\s*hora/i);
  const m = txt.match(/(\d+)\s*minuto/i);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/**
 * Lê a página do quiz. Operação SOMENTE LEITURA — não inicia tentativa,
 * não consome nada. É o que decide se vale a pena abrir a APS.
 */
export async function triar(page: Page, cfg: Config, item: ItemAPS): Promise<Triagem> {
  await page.goto(cfg.MOODLE_URL + PATHS.quizView(item.cmid), {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await pause(900);

  const bruto = await page.evaluate(() => {
    const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    // O painel de acessibilidade do tema polui o texto da região principal;
    // cortamos nele para não confundir os parsers de data.
    const main = limpar(document.querySelector('[role="main"], #region-main')?.textContent);
    const texto = main.split(/Acessibilidade\s+Redefinir tudo/)[0] ?? main;

    // Cada tentativa aparece num bloco "Resumo da tentativa N".
    //
    // A classe da tabela é `quizreviewsummary` — NÃO `quizattemptsummary`,
    // que não existe nesta página. Contar a errada devolvia sempre zero, e
    // com isso a regra "só APS intocada" nunca disparava: uma APS já feita
    // passava pelo portão como se fosse virgem.
    const blocos = Array.from(document.querySelectorAll('table'))
      .map((t) => limpar(t.textContent))
      .filter((t) => /Resumo da tentativa/i.test(t));

    return {
      titulo: limpar(document.querySelector('h1')?.textContent),
      texto,
      linhasTentativas: blocos,
      // Uma tentativa aberta aparece como "Nunca enviadas" ou "Em andamento".
      abertaNaTabela: blocos.some((b) => /Nunca enviadas|Em andamento/i.test(b)),
      temFormIniciar: Boolean(document.querySelector('form[action*="startattempt"]')),
      textoBotao: limpar(
        document.querySelector('form[action*="startattempt"] button, .singlebutton a')?.textContent,
      ),
      // Link direto para uma tentativa em curso, se houver.
      temLinkContinuar: Boolean(document.querySelector('a[href*="attempt.php?attempt="]')),
    };
  });

  const permitidas = bruto.texto.match(/Tentativas permitidas:\s*(\d+)/i);
  const aberto = bruto.texto.match(/Aberto:\s*([^]*?)(?=Fecha:|Tentativas|Responder|$)/i);
  const fecha = bruto.texto.match(/Fecha:\s*([^]*?)(?=Responder|Tentativas|Dura|$)/i);
  const duracao = bruto.texto.match(/Dura[çc][ãa]o m[áa]xima:\s*([^]*?)(?=M[ée]todo|$)/i);

  const tentativasPermitidas = permitidas?.[1] ? Number(permitidas[1]) : null;
  const tentativasUsadas = bruto.linhasTentativas.length;

  // Detecção por três sinais independentes: o rótulo do botão muda com o
  // idioma e o tema, então sozinho não basta. O estado na tabela
  // ("Nunca enviadas") é o mais confiável.
  const emAndamento =
    bruto.abertaNaTabela ||
    /continuar|retomar/i.test(bruto.textoBotao) ||
    (bruto.temLinkContinuar && !bruto.temFormIniciar);

  return {
    cmid: item.cmid,
    titulo: bruto.titulo,
    tentativasPermitidas,
    tentativasUsadas,
    tentativasRestantes:
      tentativasPermitidas === null ? null : Math.max(0, tentativasPermitidas - tentativasUsadas),
    abreEm: aberto?.[1] ? parseDataMoodle(aberto[1]) : null,
    fechaEm: fecha?.[1] ? parseDataMoodle(fecha[1]) : null,
    duracaoMaxMin: duracao?.[1] ? parseDuracao(duracao[1]) : null,
    podeIniciar: bruto.temFormIniciar,
    emAndamento,
  };
}

export type Veredito = { ok: boolean; motivo: string };

/**
 * Decide se a APS pode ser aberta automaticamente.
 *
 * Regra central: o robô só toca em APS **virgem** — zero tentativas
 * concluídas. Se você já fez alguma tentativa, ela não é refeita nem que
 * ainda sobrem tentativas; aquilo é seu trabalho e não cabe ao robô
 * sobrescrever. Em compensação, uma APS intocada é executada mesmo tendo
 * uma única tentativa.
 *
 * Isso substitui o antigo portão de "última tentativa", que protegia a
 * coisa errada: bloqueava justamente as APS que ninguém tinha começado,
 * e liberava re-executar as que você já havia feito.
 */
export function avaliar(
  t: Triagem,
  cfg: Config,
  opts: { forcar?: boolean } = {},
): Veredito {
  const agora = new Date();

  // Tentativa aberta e inacabada: é retomada, não recomeço. Normalmente é
  // uma execução nossa que caiu no meio.
  if (t.emAndamento) return { ok: true, motivo: 'tentativa em andamento — retomar' };

  // `forcar` existe só para teste deliberado numa APS já feita. Nunca é
  // ligado pelo agendador: a regra padrão é justamente não refazer o que
  // você já entregou.
  if (t.tentativasUsadas > 0 && !opts.forcar) {
    return {
      ok: false,
      motivo: `já tem ${t.tentativasUsadas} tentativa(s) feita(s) — não refazer (use --forcar para testar)`,
    };
  }

  if (!t.podeIniciar) return { ok: false, motivo: 'sem botão de iniciar (fechada ou indisponível)' };
  if (t.abreEm && agora < t.abreEm) return { ok: false, motivo: `abre em ${t.abreEm.toLocaleString('pt-BR')}` };
  if (t.fechaEm && agora > t.fechaEm) return { ok: false, motivo: 'prazo encerrado' };

  if (t.fechaEm) {
    const minutosRestantes = (t.fechaEm.getTime() - agora.getTime()) / 60_000;
    if (minutosRestantes < cfg.DEADLINE_MARGIN_MINUTES) {
      return {
        ok: false,
        motivo: `faltam ${Math.round(minutosRestantes)}min para o prazo (margem: ${cfg.DEADLINE_MARGIN_MINUTES}min)`,
      };
    }
  }

  if (t.tentativasRestantes === 0) return { ok: false, motivo: 'sem tentativas restantes' };

  return {
    ok: true,
    motivo:
      t.tentativasUsadas > 0
        ? `FORÇADO: já tinha ${t.tentativasUsadas} tentativa(s), sobra(m) ${t.tentativasRestantes ?? '?'}`
        : `ok (intocada, ${t.tentativasPermitidas ?? '?'} tentativa(s) permitida(s))`,
  };
}
