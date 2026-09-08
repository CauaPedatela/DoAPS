import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import type { Config } from '../../config/env.ts';
import { comRetry } from '../../core/retry.ts';
import { logger } from '../../core/logger.ts';
import { SISTEMA, renderizar, montarPartes } from '../prompt.ts';
import type { ImagemPronta } from '../../extraction/images.ts';
import { LoteSchema, type Questao, type Resposta, type Uso } from '../types.ts';
import type { Solver } from './types.ts';

export class GeminiSolver implements Solver {
  readonly nome = 'gemini';
  readonly modelo: string;
  /** Modelos a tentar em ordem quando o principal está congestionado. */
  readonly #cadeia: string[];
  readonly #ai: GoogleGenAI;

  constructor(cfg: Config) {
    if (!cfg.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente');
    this.#ai = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
    this.modelo = cfg.AI_MODEL;
    this.#cadeia = [
      cfg.AI_MODEL,
      ...cfg.AI_MODEL_FALLBACKS.split(',')
        .map((m) => m.trim())
        .filter((m) => m && m !== cfg.AI_MODEL),
    ];
  }

  async resolver(
    questoes: Questao[],
    imagens?: Map<string, ImagemPronta>,
  ): Promise<{ respostas: Resposta[]; uso: Uso }> {
    if (questoes.length === 0) return { respostas: [], uso: { entrada: 0, saida: 0, cacheadas: 0 } };

    // Imagens só entram quando existem de fato — a maioria das questões é
    // texto puro, e enviar imagem à toa multiplica o custo por ~800 tokens.
    type ParteGemini = { text: string } | { inlineData: { mimeType: string; data: string } };

    const temImagem = imagens !== undefined && imagens.size > 0;
    const partes: ParteGemini[] = temImagem
      ? montarPartes(questoes).map((p): ParteGemini => {
          if ('texto' in p) return { text: p.texto };
          const img = imagens.get(p.imagemUrl);
          // URL sem binário (download falhou) vira aviso explícito: é melhor
          // o modelo saber que está cego naquela questão do que responder
          // achando que viu tudo.
          return img
            ? { inlineData: { mimeType: img.mimeType, data: img.data } }
            : { text: '\n[IMAGEM INDISPONÍVEL — responda apenas se o texto bastar]' };
        })
      : [{ text: renderizar(questoes) }];

    if (temImagem) {
      logger.info({ imagens: imagens.size, questoes: questoes.length }, 'enviando com imagens');
    }

    // O free tier devolve 503 ("high demand") com frequência, e insistir no
    // MESMO modelo congestionado não adianta: numa execução real o
    // gemini-3.8-flash falhou 5 vezes seguidas e a APS foi abandonada com a
    // tentativa já aberta. Por isso a cadeia de modelos — em teste, o
    // 3.5-flash respondeu em 1,5s enquanto o 3.8 estava saturado.
    let r: GenerateContentResponse | undefined;
    let usado = this.modelo;
    const erros: string[] = [];

    for (const modelo of this.#cadeia) {
      try {
        r = await comRetry(
          () =>
            this.#ai.models.generateContent({
              model: modelo,
              contents: [{ role: 'user', parts: partes }],
              config: {
                systemInstruction: SISTEMA,
                responseMimeType: 'application/json',
                responseJsonSchema: z.toJSONSchema(LoteSchema),
                temperature: 0,
              },
            }),
          { rotulo: `gemini:${modelo}`, tentativas: 4, baseMs: 1500 },
        );
        usado = modelo;
        if (modelo !== this.modelo) {
          logger.warn({ principal: this.modelo, usado: modelo }, 'caiu para modelo alternativo');
        }
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        erros.push(`${modelo}: ${msg.slice(0, 90)}`);
        logger.warn({ modelo, restantes: this.#cadeia.length - this.#cadeia.indexOf(modelo) - 1 }, 'modelo indisponível, tentando o próximo');
      }
    }

    if (!r) {
      throw new Error(`Todos os modelos falharam:\n  ${erros.join('\n  ')}`);
    }

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
    logger.info({ modelo: usado, ...uso, questoes: questoes.length }, 'IA respondeu');

    return { respostas: parsed.data.respostas, uso };
  }
}
