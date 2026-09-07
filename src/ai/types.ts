import { z } from 'zod';

export const TIPOS = [
  'multichoice',
  'multichoice-multi',
  'truefalse',
  'shortanswer',
  'essay',
] as const;
export type TipoQuestao = (typeof TIPOS)[number];

export type Alternativa = {
  /** Letra apresentada à IA: 'A', 'B', … */
  letra: string;
  /** Valor real que o Moodle espera no input. NUNCA é a letra. */
  inputValue: string;
  texto: string;
  imagem?: string;
};

export type Questao = {
  slot: number;
  /** id do container div.que — usado para preencher depois */
  domId: string;
  /** name do input, para localizar o campo certo */
  inputName: string;
  tipo: TipoQuestao;
  enunciado: string;
  imagens: string[];
  alternativas: Alternativa[];
  /** SHA-256 da forma canônica — chave de cache */
  hash: string;
};

export const RespostaSchema = z.object({
  n: z.number().int(),
  /** 'C' para múltipla escolha, 'A,D' para múltipla, texto para discursiva */
  a: z.string(),
  conf: z.enum(['alta', 'media', 'baixa']),
});
export const LoteSchema = z.object({ respostas: z.array(RespostaSchema) });

export type Resposta = z.infer<typeof RespostaSchema>;

export type Uso = { entrada: number; saida: number; cacheadas: number };
