import { readFileSync } from 'node:fs';
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
    /**
     * Modelos alternativos quando o principal devolve 503. O free tier
     * satura por modelo: em teste o 3.5-flash respondeu em 1,5s enquanto
     * o 3.8 falhava seguidamente.
     */
    AI_MODEL_FALLBACKS: z.string().default('gemini-3.6-flash,gemini-3.5-flash'),

    // ─── Segurança operacional ───────────────────────────────────────
    /** Piso de tempo por questionário. Ver docs/ARQUITETURA.md §8. */
    MIN_QUIZ_MINUTES: z.coerce.number().min(0).default(8),
    /** Não abrir tentativa se faltar menos que isto para o prazo. */
    DEADLINE_MARGIN_MINUTES: z.coerce.number().min(0).default(120),

    // ─── Agendador ───────────────────────────────────────────────────
    /** Horário diário no formato HH:MM, no fuso local da máquina. */
    DAEMON_HORA: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'DAEMON_HORA deve ser HH:MM (ex: 07:20)')
      .default('07:20'),
    /** Envia de fato. Falso = preenche e deixa aberta para você revisar. */
    DAEMON_SUBMIT: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),

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

/**
 * Relê o .env em runtime, sobrescrevendo o que já está em process.env.
 *
 * `node --env-file` lê o arquivo uma única vez, no start, e
 * `process.loadEnvFile()` NÃO sobrescreve variáveis já definidas — testado.
 * Num processo que fica aberto por dias, isso significaria reiniciar o
 * agendador para mudar qualquer ajuste. Aqui o parse é próprio e o valor
 * novo vence.
 */
export function recarregarEnv(caminho = '.env'): void {
  let texto: string;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch {
    return; // sem .env (CI, container com env injetado) — segue com o que há
  }

  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const sep = limpa.indexOf('=');
    if (sep < 1) continue;
    const chave = limpa.slice(0, sep).trim();
    let valor = limpa.slice(sep + 1).trim();
    // remove aspas envolventes, se houver
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}
