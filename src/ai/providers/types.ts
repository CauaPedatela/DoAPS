import type { Questao, Resposta, Uso } from '../types.ts';
import type { ImagemPronta } from '../../extraction/images.ts';

/** Contrato único: Claude e Gemini entram por aqui. */
export interface Solver {
  readonly nome: string;
  readonly modelo: string;
  /**
   * `imagens` mapeia URL → binário já reduzido. Quem chama é responsável
   * por baixá-las (exige a sessão autenticada do Moodle); o solver só as
   * anexa. URL sem entrada no mapa é ignorada.
   */
  resolver(
    questoes: Questao[],
    imagens?: Map<string, ImagemPronta>,
  ): Promise<{ respostas: Resposta[]; uso: Uso }>;
}
