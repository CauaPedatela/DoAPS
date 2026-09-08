import type { Questao } from './types.ts';


/**
 * Instrução estável — fica no bloco cacheável, sem nada volátil dentro.
 * Qualquer data, id ou contador aqui invalidaria o cache de prompt a cada
 * requisição.
 */
export const SISTEMA = [
  'Você resolve questões de provas universitárias de Engenharia de Software.',
  'Responda SOMENTE com a alternativa correta. Nunca explique.',
  '',
  'Formato do campo "a" conforme o tipo:',
  '- multichoice / truefalse: uma letra maiúscula. Ex: "C"',
  '- multichoice-multi: letras separadas por vírgula. Ex: "A,D"',
  '- shortanswer: a resposta curta, sem pontuação final',
  '- essay: um parágrafo objetivo de 3 a 5 frases',
  '',
  'O campo "conf" indica sua confiança: alta, media ou baixa.',
  'Use "baixa" quando estiver genuinamente incerto — uma questão marcada',
  'como baixa será revisada por uma pessoa, então marcar corretamente vale',
  'mais do que aparentar certeza.',
].join('\n');

/**
 * Renderiza só o essencial: enunciado e alternativas em texto puro.
 * Nada de HTML, nota, navegação ou marcação — reduz custo e, mais
 * importante, remove ruído que competiria pela atenção do modelo.
 */
export function renderizar(questoes: Questao[]): string {
  return questoes
    .map((q) => {
      const cabeca = `[${q.slot}] (${q.tipo}) ${q.enunciado}`;
      if (q.alternativas.length === 0) return cabeca;
      const alts = q.alternativas.map((a) => `${a.letra}) ${a.texto}`).join('\n');
      return `${cabeca}\n${alts}`;
    })
    .join('\n\n');
}

export type Parte = { texto: string } | { imagemUrl: string };

/**
 * Monta o conteúdo intercalando texto e imagens.
 *
 * A imagem vai logo depois do enunciado a que pertence, com um marcador
 * antes. Mandar todas as imagens no fim, soltas, obrigaria o modelo a
 * adivinhar a associação — e com 12 imagens numa prova de 3 questões,
 * como em Pesquisa Operacional APS 4, isso seria adivinhação pura.
 */
export function montarPartes(questoes: Questao[]): Parte[] {
  const partes: Parte[] = [];

  for (const q of questoes) {
    const cabeca = `[${q.slot}] (${q.tipo}) ${q.enunciado}`;
    partes.push({ texto: partes.length === 0 ? cabeca : `\n\n${cabeca}` });

    for (const url of q.imagens) {
      partes.push({ texto: `\n(imagem do enunciado da questão ${q.slot}:)` });
      partes.push({ imagemUrl: url });
    }

    if (q.alternativas.length > 0) {
      for (const a of q.alternativas) {
        partes.push({ texto: `\n${a.letra}) ${a.texto}` });
        if (a.imagem) {
          partes.push({ texto: `\n(imagem da alternativa ${a.letra}:)` });
          partes.push({ imagemUrl: a.imagem });
        }
      }
    }
  }

  return partes;
}
