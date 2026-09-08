import pino from 'pino';

/**
 * Logger com redaction obrigatória.
 *
 * O repositório é público e os logs podem acabar colados numa issue, num
 * print ou num CI. Estes campos NUNCA podem aparecer em texto claro —
 * mesmo que alguém escreva `logger.info(config)` por distração.
 */
const REDACTED = [
  'MOODLE_PASSWORD',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'password',
  'apiKey',
  'api_key',
  'token',
  'cookie',
  'Cookie',
  '*.MOODLE_PASSWORD',
  '*.GEMINI_API_KEY',
  '*.ANTHROPIC_API_KEY',
  '*.password',
  '*.apiKey',
  '*.token',
  '*.cookie',
];

const prettyEmDev =
  process.env['NODE_ENV'] === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      };

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: { paths: REDACTED, censor: '[REDIGIDO]' },
  ...prettyEmDev,
});

/**
 * Remove segredos de uma string livre (URL com token, dump de HTML, etc.).
 * A redaction do pino só cobre campos estruturados; isto cobre o resto.
 */
export function scrub(text: string): string {
  let out = text;
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MOODLE_PASSWORD'] as const) {
    const value = process.env[key];
    if (value && value.length > 6) out = out.replaceAll(value, `[${key}]`);
  }
  // Padrões conhecidos, caso o valor não venha do ambiente
  return out
    .replace(/sk-ant-[\w-]{20,}/g, '[ANTHROPIC_API_KEY]')
    .replace(/AIza[\w-]{30,}/g, '[GEMINI_API_KEY]')
    .replace(/MoodleSession=[\w]+/g, 'MoodleSession=[REDIGIDO]');
}
