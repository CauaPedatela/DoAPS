/**
 * Diagnóstico do ambiente. Imprime PRESENÇA e FORMATO das credenciais,
 * nunca os valores — a saída deste script pode acabar num print ou numa
 * issue do repositório público.
 *
 *   node --env-file=.env src/core/doctor.ts
 */
import { loadConfig } from '../config/env.ts';

const mask = (v: string | undefined): string => {
  if (!v) return 'AUSENTE';
  return `${v.length} caracteres, começa com "${v.slice(0, 4)}…"`;
};

try {
  const cfg = loadConfig();
  console.log('✓ configuração válida\n');
  console.log('  MOODLE_URL       :', cfg.MOODLE_URL);
  console.log('  MOODLE_USERNAME  :', cfg.MOODLE_USERNAME ? `${cfg.MOODLE_USERNAME.length} caracteres` : 'AUSENTE');
  console.log('  MOODLE_PASSWORD  :', cfg.MOODLE_PASSWORD ? `${cfg.MOODLE_PASSWORD.length} caracteres` : 'AUSENTE');
  console.log('  AI_PROVIDER      :', cfg.AI_PROVIDER);
  console.log('  AI_MODEL         :', cfg.AI_MODEL);
  console.log('  GEMINI_API_KEY   :', mask(cfg.GEMINI_API_KEY));
  console.log('  BROWSER_CHANNEL  :', cfg.BROWSER_CHANNEL);
  console.log('  MIN_QUIZ_MINUTES :', cfg.MIN_QUIZ_MINUTES);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
