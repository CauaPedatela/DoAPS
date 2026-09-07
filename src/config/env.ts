import { z } from 'zod';

/**
 * Uma variável em branco no .env (`FOO=`) chega como string vazia, não como
 * `undefined` — então `.optional()` sozinho não a trata como ausente, e uma
 * validação de formato reprovaria um campo que o usuário deixou vazio de
 * propósito. Este helper normaliza "" (e espaços) para ausente.
 */
const opcional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    return t === '' ? undefined : t;
  }, schema.optional());

/**
 * Configuração do doAPS.
 *
 * Carregada por `node --env-file=.env`, validada aqui.
 * A validação é deliberadamente rígida: é melhor falhar no boot com uma
 * mensagem clara do que descobrir no meio de uma tentativa de APS que a
 * chave de API estava vazia.
 */
const Schema = z
  .object({
    // ─── Moodle ──────────────────────────────────────────────────────
    MOODLE_URL: z.url().default('https://avagrad.unievangelica.edu.br'),
    MOODLE_USERNAME: z.string().min(1, 'MOODLE_USERNAME está vazio'),
    MOODLE_PASSWORD: z.string().min(1, 'MOODLE_PASSWORD está vazio'),

    // ─── IA ──────────────────────────────────────────────────────────
    AI_PROVIDER: z.enum(['gemini', 'claude']).default('gemini'),
    // O Google emite chaves em mais de um formato ('AIza…' antigo, 'AQ.…'
    // novo do AI Studio), então validamos só o comprimento — travar num
    // prefixo específico rejeitaria chaves válidas.
    GEMINI_API_KEY: opcional(z.string().min(20)),
    ANTHROPIC_API_KEY: opcional(z.string().startsWith('sk-ant-')),
    AI_MODEL: z.string().default('gemini-3.8-flash'),

    // ─── Segurança operacional ───────────────────────────────────────
    /** Tentativas que o robô nunca consome. 1 = sempre sobra uma pra você. */
    ATTEMPT_RESERVE: z.coerce.number().int().min(0).default(1),
    /** Piso de tempo por questionário. Ver docs/ARQUITETURA.md §8. */
    MIN_QUIZ_MINUTES: z.coerce.number().min(0).default(8),
    /** Não abrir tentativa se faltar menos que isto para o prazo. */
    DEADLINE_MARGIN_MINUTES: z.coerce.number().min(0).default(120),

    // ─── Execução ────────────────────────────────────────────────────
    /** Usa o Chrome já instalado — sem baixar Chromium, fingerprint real. */
    BROWSER_CHANNEL: z.enum(['chrome', 'msedge', 'chromium']).default('chrome'),
    HEADED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() === 'true'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
  })
  // Exige a chave do provedor efetivamente selecionado — e só dela.
  // Não faz sentido cobrar ANTHROPIC_API_KEY de quem vai usar Gemini.
  .refine((e) => e.AI_PROVIDER !== 'gemini' || Boolean(e.GEMINI_API_KEY), {
    message:
      'AI_PROVIDER=gemini exige GEMINI_API_KEY. A sua é grátis: https://aistudio.google.com/apikey',
    path: ['GEMINI_API_KEY'],
  })
  .refine((e) => e.AI_PROVIDER !== 'claude' || Boolean(e.ANTHROPIC_API_KEY), {
    message:
      'AI_PROVIDER=claude exige ANTHROPIC_API_KEY. Console: https://console.anthropic.com',
    path: ['ANTHROPIC_API_KEY'],
  });

export type Config = z.infer<typeof Schema>;

function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `  • ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('\n');
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      'Configuração inválida — confira o seu .env:\n' +
        formatIssues(parsed.error) +
        '\n\nDica: copie o .env.example e preencha os campos vazios.',
    );
  }
  return parsed.data;
}
