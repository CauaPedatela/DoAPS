import type { Questao, Resposta, Uso } from '../types.ts';

/** Contrato único: Claude e Gemini entram por aqui. */
export interface Solver {
  readonly nome: string;
  readonly modelo: string;
  resolver(questoes: Questao[]): Promise<{ respostas: Resposta[]; uso: Uso }>;
}
