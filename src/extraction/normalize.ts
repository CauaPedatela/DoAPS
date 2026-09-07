import { createHash } from 'node:crypto';

/**
 * Forma canônica de um texto de questão, para servir de chave de cache.
 *
 * Normaliza o que varia sem mudar o significado (espaços, caixa,
 * numeração da questão) e preserva o que é semântico — inclusive acentos.
 */
export function canonizar(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .replace(/^\s*\[?\d+[).\]]\s*/, '') // numeração inicial
    .trim()
    .toLowerCase();
}

/** Hash estável do enunciado + alternativas (ordenadas, para resistir a embaralhamento). */
export function hashQuestao(enunciado: string, alternativas: string[]): string {
  const base = [canonizar(enunciado), ...alternativas.map(canonizar).sort()].join('\u0000');
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}
