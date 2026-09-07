import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Config } from '../../config/env.ts';
import { comRetry } from '../../core/retry.ts';
import { logger } from '../../core/logger.ts';
import { SISTEMA, renderizar } from '../prompt.ts';
import { LoteSchema, type Questao, type Resposta, type Uso } from '../types.ts';
import type { Solver } from './types.ts';

export class GeminiSolver implements Solver {
  readonly nome = 'gemini';
  readonly modelo: string;
  readonly #ai: GoogleGenAI;

  constructor(cfg: Config) {
    if (!cfg.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente');
    this.#ai = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
    this.modelo = cfg.AI_MODEL;
  }

  async resolver(questoes: Questao[]): Promise<{ respostas: Resposta[]; uso: Uso }> {
    if (questoes.length === 0) return { respostas: [], uso: { entrada: 0, saida: 0, cacheadas: 0 } };

    // Imagens só entram quando existem de fato — a maioria das questões é
    // texto puro, e enviar imagem à toa multiplica o custo por ~800 tokens.
    const partes: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: renderizar(questoes) },
    ];

    const r = await comRetry(
      () =>
        this.#ai.models.generateContent({
          model: this.modelo,
          contents: [{ role: 'user', parts: partes }],
          config: {
            systemInstruction: SISTEMA,
            responseMimeType: 'application/json',
            responseJsonSchema: z.toJSONSchema(LoteSchema),
            temperature: 0,
          },
        }),
      { rotulo: `gemini:${this.modelo}`, tentativas: 5 },
    );

    const texto = r.text ?? '';
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error(`Resposta do modelo não é JSON: ${texto.slice(0, 160)}`);
    }

    const parsed = LoteSchema.safeParse(bruto);
    if (!parsed.success) {
      throw new Error(`Resposta fora do schema: ${JSON.stringify(parsed.error.issues).slice(0, 200)}`);
    }

    const u = r.usageMetadata;
    const uso: Uso = {
      entrada: u?.promptTokenCount ?? 0,
      saida: u?.candidatesTokenCount ?? 0,
      cacheadas: u?.cachedContentTokenCount ?? 0,
    };
    logger.info({ modelo: this.modelo, ...uso, questoes: questoes.length }, 'IA respondeu');

    return { respostas: parsed.data.respostas, uso };
  }
}
