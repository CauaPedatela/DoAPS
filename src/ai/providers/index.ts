import type { Config } from '../../config/env.ts';
import { GeminiSolver } from './gemini.ts';
import type { Solver } from './types.ts';

export function criarSolver(cfg: Config): Solver {
  switch (cfg.AI_PROVIDER) {
    case 'gemini':
      return new GeminiSolver(cfg);
    case 'claude':
      throw new Error('Provedor claude ainda não implementado. Use AI_PROVIDER=gemini.');
  }
}
export type { Solver };
