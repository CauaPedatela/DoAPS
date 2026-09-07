# doAPS — Automação de APS no AVA UniEVANGÉLICA

**Documento de arquitetura e estudo de viabilidade**
Data: 07/09/2026 · Alvo: `avagrad.unievangelica.edu.br`

---

## 1. Veredito

**Viável, e mais simples do que parece.** O alvo não é um site genérico: é um **Moodle**, e isso muda tudo. Moodle tem DOM estável, versionado e documentado publicamente. Não vamos fazer scraping adivinhando seletores — vamos programar contra uma estrutura conhecida.

O risco real do projeto **não é técnico e não é custo**. É que a APS permite **2 tentativas** e vale nota. Toda a arquitetura abaixo é desenhada em torno disso: gastar tentativas é o recurso caro, não tokens.

---

## 2. O que eu testei de fato (não é suposição)

Antes de projetar, sondei o alvo. Só requisições públicas, sem usar suas credenciais.

| # | Teste | Resultado | Impacto no projeto |
|---|---|---|---|
| 1 | Identificação da plataforma | **Moodle**, tema `snap`, `pt_br`, tz `América/São_Paulo` | Seletores conhecidos. Não precisamos de IA para navegar. |
| 2 | `M.cfg` exposto no HTML | `sesskey`, `wwwroot`, `apibase: /r.php/api`, `sessiontimeout: 14400` | Sessão dura **4h** → um login serve para um run inteiro. `sesskey` disponível se precisarmos de AJAX. |
| 3 | Estrutura do form de login | POST simples: `logintoken` (CSRF) + `username` + `password` | Login é trivial de automatizar. |
| 4 | **CAPTCHA / reCAPTCHA** | **Ausente.** Nem na tela inicial, nem após falha de login | Não precisamos de serviço de resolução de captcha. Grande simplificação. |
| 5 | **MFA / 2FA / SSO** | **Ausente.** Só usuário e senha | Fluxo de auth de uma etapa. |
| 6 | Login com usuário inexistente | HTTP 200 + `alert-danger` "Nome de usuário ou senha errados" + **novo `logintoken`** | Erro é detectável de forma determinística. Sem lockout agressivo aparente. |
| 7 | Headers de resposta | `Server: Apache`, `MoodleSession` (secure, HttpOnly), **sem Cloudflare/WAF** | Sem proteção anti-bot de borda. |
| 8 | `/login/token.php?service=moodle_mobile_app` | HTTP 200 → `{"errorcode":"invalidlogin"}` | **O Web Service móvel está habilitado.** Existe um caminho alternativo sem navegador — ver §11. |
| 9 | Node 24 builtins (`node:sqlite`, `util.parseArgs`, `node:test`) | Todos funcionais na sua máquina | Cache, CLI e testes com **zero dependências extras**. |

> Conclusão da sondagem: **não há nada no alvo que exija técnicas de evasão.** O "delay humano" que você pediu continua no projeto, mas pelo motivo certo — ver §8.

---

## 3. A decisão mais importante: custo não é o gargalo

Você pediu para otimizar tokens. Fiz a conta com os preços reais da API, e ela contradiz a premissa — o que é uma boa notícia.

Uma APS típica: ~10 questões, enunciado + 5 alternativas ≈ **300 tokens por questão** depois de extrair só o essencial. Um questionário inteiro cabe em **~3.500 tokens de entrada** e devolve **~120 tokens de saída** (só as letras, em JSON).

| Provedor / Modelo | ID | Preço in/out (US$/1M) | **Semestre inteiro** (5 disciplinas × 8 APS = 40) |
|---|---|---|---|
| Gemini Flash — **free tier** | `gemini-3.8-flash` | $0 / $0 ⚠ | **$0** (ver ressalva §3.1) |
| Gemini Flash — pago | `gemini-3.8-flash` | $0,75 / $3,75 | **~$0,12** |
| Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | **~$0,16** |
| Sonnet 5 | `claude-sonnet-5` | $2 / $10 | **~$0,33** |
| **Opus 5** | `claude-opus-5` | $5 / $25 | **~$3,80** * |

\* Opus 5 tem *thinking* ligado por padrão, e tokens de raciocínio são cobrados como saída. Já incluído.

Carga total do semestre: **~140k tokens de entrada e ~5k de saída.** É pouco. **A opção mais cara do quadro custa menos de R$ 20 por semestre**, e a diferença entre a mais barata e a mais cara é de ~R$ 19. Esse troco não paga um erro em questão que vale nota, num contexto de **2 tentativas**.

### 3.1 Nenhuma das suas assinaturas cobre isto

Verificado na documentação oficial dos dois:

- **Claude Pro** — não inclui API nem créditos. Console e assinatura são cobranças separadas.
- **Google AI Pro** — mesma coisa, e de forma ainda mais restrita. A cota do plano vale **apenas dentro da interface web do AI Studio**. A doc do Google é explícita: *"Direct use of the Gemini API (such as using API keys or external applications) is billed and managed separately."* Ou seja: o plano de R$ 100/mês **não gera um token a mais** para o nosso pipeline.

O que existe de verdade e não tem equivalente na Anthropic é o **free tier da Gemini API** — chave de API grátis, sem cartão, com limite de taxa. Nosso semestre inteiro são ~40 requisições; o free tier dá ~1.500/dia. **Cabe folgado.**

A ressalva não é técnica, é contratual: **no free tier do Google, seus prompts podem ser usados para treinar os modelos deles e revistos por avaliadores humanos.** Nos tiers pagos (Google e Anthropic), não. Como o payload são enunciados de prova da sua faculdade, essa é uma decisão sua a tomar conscientemente — não um detalhe de configuração.

### Recomendação

Padrão **`claude-opus-5`** com `effort: "low"`, e o provedor **trocável por `.env`** (§7.6). O custo não decide nada aqui; **precisão decide**. As otimizações de token da §7 continuam valendo integralmente — elas não são sobre dinheiro, são sobre qualidade: menos ruído no prompt, melhor resposta.

---

## 4. Stack e justificativas

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime | **Node.js 24** + **TypeScript** | Já instalado. TS dá contratos tipados entre os estágios do pipeline — crítico quando um erro custa uma tentativa. |
| Automação | **Playwright** (não Puppeteer) | Ver quadro abaixo. |
| IA | **`@anthropic-ai/sdk`** (padrão) + **`@google/genai`** (alternativo) | Ambos atrás da interface `Solver` (§7.6). Os dois têm saída estruturada por schema e visão. Trocável por `.env`, comparável por medição (§7.7). |
| Validação | **Zod** | Valida `.env` no boot (falha rápido) *e* valida a saída da IA (`zodOutputFormat`). Uma lib, dois usos. |
| Imagens | **sharp** | Reduz imagem para 768px antes de enviar → menos tokens e menos ruído. |
| Logs | **pino** | Tem *redaction* nativa: senha e API key nunca vazam pro log, mesmo por acidente. |
| Cache | **`node:sqlite`** (builtin) | Testado na sua máquina. Zero dependência. |
| CLI | **`node:util.parseArgs`** (builtin) | Testado. Dispensa `commander`/`yargs`. |
| Testes | **`node:test`** (builtin) | Testado. Dispensa Jest/Vitest. |

Total: **5 dependências de produção.** Superfície pequena de propósito — menos coisa para quebrar e para auditar.

### Playwright vs Puppeteer

Ambos resolveriam. Playwright ganha por três motivos concretos neste projeto:

1. **Auto-waiting nos locators.** Playwright espera o elemento ficar acionável antes de clicar. Puppeteer exige `waitForSelector` manual em todo lugar. Menos código, menos flakiness — e flakiness aqui queima tentativa.
2. **`storageState`.** Serializa cookies e localStorage num JSON. Login uma vez, reaproveite por 4h (o `sessiontimeout` que medimos). Menos eventos de login no log de auditoria do Moodle.
3. **Trace viewer.** Grava DOM, screenshots e rede de cada passo. Quando algo falhar dentro de uma tentativa real, você reproduz offline em vez de gastar a segunda tentativa depurando.

---

## 5. Arquitetura: pipeline determinístico com um único ponto de IA

O princípio que você pediu, levado a sério: **a IA não navega, não decide, não clica.** Ela recebe texto de uma questão e devolve uma letra. Nada mais.

```
┌─────────────────────────────────────────────────────────────────┐
│                    DETERMINÍSTICO (Playwright)                   │
│                                                                  │
│  [1] auth ──── login + storageState (.auth/state.json)          │
│       ↓                                                          │
│  [2] discover ─ GET /my/courses.php → courseIds[]               │
│       ↓                                                          │
│  [3] scan ───── GET /course/view.php?id=N                       │
│                 varre sidebar → /^APS\s*\d+/i → cmids[]         │
│       ↓                                                          │
│  [4] triage ─── GET /mod/quiz/view.php?id=cmid                  │
│                 aberto? prazo? tentativas restantes? já feito?  │
│       ↓         ── descarta o que não deve ser respondido ──    │
│  [5] attempt ── POST startattempt.php → attempt.php             │
│       ↓                                                          │
│  [6] extract ── DOM → Question[]  (payload mínimo)              │
│       │                                                          │
│       ├──────────────────┐                                       │
│       │                  ↓                                       │
│       │   ╔══════════════════════════════════╗                  │
│       │   ║   [7] solve   ← ÚNICO PONTO IA   ║                  │
│       │   ║   cache SQLite → miss? → Claude  ║                  │
│       │   ║   entra: enunciado + alternativas ║                  │
│       │   ║   sai:   {"n":1,"a":"C"}          ║                  │
│       │   ╚══════════════════════════════════╝                  │
│       ↓                  ↓                                       │
│  [8] fill ───── clica radio / marca checkbox / digita texto     │
│       ↓                                                          │
│  [9] submit ─── summary.php → "Enviar tudo e terminar"          │
│       ↓         ⚠ bloqueado por flag --submit                   │
│  [10] report ── runs/<timestamp>.json + resumo em markdown      │
└─────────────────────────────────────────────────────────────────┘
```

Cada estágio é uma função pura sobre o estágio anterior. `extract` e `solve` **não tocam no navegador** — recebem/devolvem dados. Isso os torna testáveis offline, o que leva ao mecanismo de segurança central do projeto:

### O modo fixture — como não queimar suas 2 tentativas

Este é o ponto mais importante da arquitetura inteira.

```
--dry-run      abre a tentativa, extrai, resolve, PREENCHE, e para.
               Salva o HTML bruto em fixtures/. NÃO envia.

--offline      não abre navegador nenhum. Roda [6][7][8] contra o
               HTML salvo em fixtures/. Custo: zero tentativas.

--submit       único modo que chama "Enviar tudo e terminar".
               Exige confirmação interativa por padrão.
```

Fluxo de desenvolvimento: rode `--dry-run` **uma vez** para capturar HTML real. Depois desenvolva e teste os extratores em `--offline` quantas vezes quiser, sem tocar em tentativa. Só quando os testes passarem contra o HTML real é que você roda `--submit`.

O Moodle salva rascunho automaticamente (autosave a cada ~2min), então `--dry-run` deixa a tentativa preenchida e aberta — você pode revisar tudo no navegador e enviar manualmente. **Sugiro que esse seja o modo padrão do projeto**, com `--submit` como opt-in explícito.

---

## 6. Estágios em detalhe

### [3] Varredura da sidebar

Na sidebar do curso, cada atividade é um link com o texto visível. O padrão que você mostrou (`APS 05 - Atividade Prática Supervisionada`) casa com:

```typescript
const APS_PATTERN = /^\s*APS\s*0*(\d+)\b/i;
```

O Moodle ainda marca o estado de conclusão na sidebar (o círculo cheio/vazio dos seus prints). Serve como filtro barato, mas **não é autoritativo** — a confirmação real vem do estágio [4], lendo a página do quiz.

### [4] Triagem — o estágio que evita desastre

Antes de abrir qualquer tentativa, lê `/mod/quiz/view.php?id=cmid` e extrai:

- Janela de disponibilidade (`Aberto:` / `Fecha:`)
- `Tentativas permitidas` e quantas já foram usadas
- `Duração máxima` (a APS do print: 1h40 — folga enorme)
- `Método de avaliação` (Nota mais alta)

Regras de guarda, todas configuráveis:

- Nunca abrir tentativa se `restantes <= reserva` (padrão: reserva = 1 — sempre deixa uma tentativa manual)
- Nunca abrir se faltar menos que N minutos para o prazo
- Nunca abrir se já existir tentativa em progresso não finalizada — **retomar** essa, não criar outra

### [6] Extração — o contrato de dados

Do container `div.que` de cada questão, extraímos **exatamente** isto e nada mais:

```typescript
type Question = {
  slot: number;                 // posição
  domId: string;                // 'question-1234-1' → para preencher depois
  qtype: 'multichoice' | 'multichoice-multi' | 'truefalse'
       | 'essay' | 'shortanswer';
  stem: string;                 // .qtext em texto puro
  stemImages: string[];         // URLs, só se existirem
  options?: Array<{
    key: string;                // 'a' | 'b' | ...
    inputValue: string;         // value real do <input> — o que o Moodle espera
    text: string;
    image?: string;
  }>;
  hash: string;                 // SHA-256 da forma canônica → chave de cache
};
```

Nada de HTML, CSS, script, navegação, cabeçalho, botão "marcar questão" ou informação de nota entra nesse objeto. É isso que a IA vê.

> Detalhe que evita um bug clássico: guardamos `inputValue` separado de `key`. A letra que a IA devolve ("C") **não** é o valor que o Moodle espera no `<input>` — o Moodle usa índices próprios e **embaralha alternativas** entre tentativas. Traduzir `key → inputValue` no momento de preencher é obrigatório. Preencher pela letra direto é o erro que faz o sistema marcar a alternativa errada silenciosamente.

### [8] Preenchimento por tipo

| Tipo | Estratégia |
|---|---|
| `multichoice` | `input[type=radio][value="<inputValue>"]` → `.check()` |
| `multichoice-multi` | idem, múltiplos `.check()` |
| `truefalse` | radio, mesmo caminho |
| `shortanswer` | `pressSequentially()` com jitter por caractere |
| `essay` | textarea simples **ou** TinyMCE — detectar o `iframe#..._ifr` e digitar dentro dele |

O caso do TinyMCE é o único realmente chato: o editor rico do Moodle renderiza num iframe e ignora `fill()`. A saída é `frameLocator()` + digitação no `body[contenteditable]`, ou setar via API do editor. Trato como tarefa dedicada no roadmap.

---

## 7. Estratégia de IA

Cinco camadas, aplicadas em ordem. As três primeiras eliminam chamadas; as duas últimas barateiam as que sobram.

**1. Payload mínimo (§6).** Só enunciado e alternativas. Reduz ~40KB de HTML para ~1KB de texto — e melhora a precisão, porque não há ruído competindo pela atenção do modelo.

**2. Cache por hash de conteúdo.** SHA-256 do texto canônico (minúsculas, espaços colapsados, numeração removida) → `cache/answers.db` via `node:sqlite`. A APS permite 2 tentativas; a segunda custa **zero tokens**. Entre semestres e entre disciplinas, questões se repetem.

**3. Batching.** As ~10 questões vão numa única requisição, não dez. O system prompt é enviado uma vez em vez de dez.

**4. Prompt caching.** O system prompt fica num bloco estável com `cache_control: { type: 'ephemeral' }`; as questões vão depois, na parte volátil. Leituras de cache custam ~10% do preço normal. Verificável em `usage.cache_read_input_tokens` — se vier zero em requisições repetidas, tem invalidador silencioso no prefixo.

**5. Structured output.** A resposta é forçada a um schema Zod mínimo. Saída de ~12 tokens por questão em vez de um parágrafo.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const AnswerSet = z.object({
  answers: z.array(z.object({
    n: z.number(),                        // slot da questão
    a: z.string(),                        // 'C' | 'A,D' | texto (discursiva)
    confidence: z.enum(['high', 'medium', 'low']),
  })),
});

const res = await client.messages.parse({
  model: process.env.AI_MODEL ?? 'claude-opus-5',
  max_tokens: 4096,
  system: [{
    type: 'text',
    text: SYSTEM_PROMPT,                  // estável → cacheável
    cache_control: { type: 'ephemeral' },
  }],
  messages: [{ role: 'user', content: renderQuestions(batch) }],
  output_config: {
    effort: 'low',                        // MCQ não precisa de xhigh
    format: zodOutputFormat(AnswerSet),
  },
});

const answers = res.parsed_output;        // null se o parse falhar — sempre checar
```

O campo `confidence` é barato (3 tokens) e vale muito: qualquer questão marcada `low` entra no relatório final como "revisar manualmente". Você ganha uma lista curta do que conferir antes de enviar.

### Questões com imagem

Só baixamos a imagem se a questão tiver uma. Antes de enviar: `sharp` reduz para 768px no lado maior e recomprime em JPEG. O custo em tokens de uma imagem é ≈ `(largura × altura) / 750`, então 1092×1092 (~1.590 tokens) vira 768×768 (~790 tokens) — metade, sem perda de legibilidade para texto de enunciado. Imagens idênticas são deduplicadas por hash dentro do mesmo batch.

### Roteamento por tipo

Um `router.ts` simples escolhe o esforço, não o modelo:

- múltipla escolha só-texto → `effort: 'low'`
- questão com imagem → `effort: 'medium'`
- discursiva → `effort: 'medium'`, `max_tokens` maior

Trocar de modelo por questão **fragmenta o cache de prompt** (o cache é por modelo), então mexer no `effort` dentro de um único modelo é a alavanca mais eficiente aqui.

### 7.6 Camada de provedor — Claude e Gemini atrás da mesma interface

Como a IA já está isolada num único estágio, trocar de provedor é barato. Definimos uma interface e duas implementações:

```typescript
// src/ai/providers/types.ts
export interface Solver {
  readonly name: string;                       // 'claude' | 'gemini'
  solve(batch: Question[]): Promise<Answer[]>; // mesma entrada, mesma saída
}
```

```
src/ai/providers/
├─ types.ts        # a interface acima
├─ anthropic.ts    # messages.parse + zodOutputFormat + prompt caching
├─ gemini.ts       # generateContent + responseSchema (JSON mode nativo)
└─ index.ts        # fábrica: lê AI_PROVIDER do .env
```

Os dois SDKs suportam saída estruturada por schema e entrada de imagem, então o contrato `Question[] → Answer[]` se mantém idêntico. O que muda fica confinado ao adaptador:

| | Anthropic | Gemini |
|---|---|---|
| Saída estruturada | `output_config.format` + `zodOutputFormat` | `responseSchema` + `responseMimeType: 'application/json'` |
| Cache de prompt | `cache_control: { type: 'ephemeral' }` | *context caching* (mínimo de tokens maior; provavelmente não compensa no nosso tamanho de prompt) |
| Controle de raciocínio | `output_config.effort` | `thinkingConfig.thinkingBudget` |
| Free tier | não existe | existe, com dados usados para treino |

### 7.7 O harness de avaliação — decidindo por medição, não por opinião

Aqui está o ponto: **as fixtures da Fase 3 já são um conjunto de avaliação pronto.** Você tem APS anteriores já corrigidas, ou seja, gabarito real.

```bash
npm run eval -- --provider claude --model claude-opus-5
npm run eval -- --provider gemini --model gemini-3.8-flash
```

O comando roda os dois provedores sobre as mesmas questões salvas, compara com o gabarito conhecido e imprime acerto, custo e latência. Custo de tentativas: **zero** — é tudo offline.

Com 2 tentativas por APS, "qual modelo acerta mais **nas minhas questões**" não é pergunta para se responder por intuição ou por benchmark de terceiro. Meça uma vez, com ~20 questões reais, e a decisão fica resolvida com dados seus.

---

## 8. Ritmo humano — pelo motivo certo

Não encontramos detector de bot (§2). Então o objetivo do delay **não é evadir detecção** — é outra coisa, mais relevante:

**O Moodle registra tudo em `mdl_logstore_standard_log`, e o professor tem acesso.** Ele vê horário de abertura, de cada navegação e de envio. Uma prova de 10 questões enviada em 40 segundos é visível a olho nu no relatório de atividade. O ritmo aqui é sobre o registro parecer com o que ele descreve, não sobre burlar um firewall.

Implementação em `core/humanize.ts`:

```typescript
// Jitter lognormal, não uniforme.
// Delays humanos são assimétricos à direita: muitos rápidos, alguns longos.
// Um delay uniforme é, ele próprio, uma assinatura.
export function humanDelay(medianMs: number, sigma = 0.35): number {
  const z = Math.sqrt(-2 * Math.log(Math.random()))
          * Math.cos(2 * Math.PI * Math.random());     // Box-Muller
  return Math.round(medianMs * Math.exp(sigma * z));
}

// Tempo de leitura proporcional ao texto (~200 palavras/min) + jitter
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return humanDelay((words / 200) * 60_000 + 1_500);
}
```

Políticas aplicadas:

- **Piso de tempo total por questionário.** Nunca finalizar 10 questões em menos de ~8 min (configurável). Se o pipeline terminar antes, ele espera.
- Pausa de leitura por questão proporcional ao tamanho do enunciado.
- Digitação caractere a caractere (`pressSequentially`, 60–160ms com jitter) em discursivas.
- **Estritamente sequencial.** Um contexto de navegador, um questionário por vez. Nada de paralelismo.
- Contexto com `locale: 'pt-BR'`, `timezoneId: 'America/Sao_Paulo'`, viewport não-default e User-Agent real — coerente com o `usertimezone` que o próprio `M.cfg` já reporta.
- Backoff exponencial em 5xx; respeitar `Retry-After`.

---

## 9. Segurança e segredos

Requisito seu: subir no Git sem vazar nada.

### O que **nunca** entra no repositório

| Arquivo | Contém | Proteção |
|---|---|---|
| `.env` | login, senha, `ANTHROPIC_API_KEY` | `.gitignore` |
| `.auth/state.json` | **cookie de sessão ativa** — equivale à sua senha por 4h | `.gitignore` |
| `fixtures/` | HTML real com conteúdo de prova e dados pessoais | `.gitignore` |
| `runs/`, `cache/` | respostas, hashes, histórico | `.gitignore` |

> `.auth/state.json` é o mais perigoso e o mais fácil de esquecer. Um `MoodleSession` válido dá acesso total à sua conta sem senha. Ele está no `.gitignore` **e** deve ser apagado ao fim de cada run se você não for reusar.

### Configuração

Node 24 lê `.env` nativamente — sem `dotenv`:

```bash
node --env-file=.env dist/cli.js --dry-run
```

Validado com Zod no boot, para falhar cedo e com mensagem clara:

```typescript
// src/config/env.ts
export const Env = z.object({
  MOODLE_URL:        z.string().url().default('https://avagrad.unievangelica.edu.br'),
  MOODLE_USERNAME:   z.string().min(1),
  MOODLE_PASSWORD:   z.string().min(1),

  AI_PROVIDER:       z.enum(['claude', 'gemini']).default('claude'),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
  GEMINI_API_KEY:    z.string().min(1).optional(),
  AI_MODEL:          z.string().default('claude-opus-5'),

  MIN_QUIZ_MINUTES:  z.coerce.number().default(8),
  ATTEMPT_RESERVE:   z.coerce.number().default(1),
})
  // exige a chave do provedor efetivamente selecionado
  .refine(e => e.AI_PROVIDER === 'claude' ? !!e.ANTHROPIC_API_KEY : !!e.GEMINI_API_KEY,
          { message: 'Falta a API key do AI_PROVIDER selecionado' })
  .parse(process.env);
```

`.env.example` vai versionado, com as chaves e sem os valores.

### Defesa em profundidade

1. **`.gitignore`** — primeira barreira.
2. **Redaction no pino** — `redact: ['*.password', '*.apiKey', 'MOODLE_PASSWORD', 'ANTHROPIC_API_KEY']`. Mesmo um `logger.info(config)` distraído não vaza.
3. **Hook de pre-commit** rodando [`gitleaks`](https://github.com/gitleaks/gitleaks) — barra o commit se detectar padrão de segredo. Usar `.githooks/` versionado + `git config core.hooksPath .githooks` (dispensa `husky`).
4. **CI** com `gitleaks detect` no histórico completo.

> Se algum segredo já tiver sido commitado alguma vez: `.gitignore` **não remove do histórico**. Nesse caso, rotacione a credencial (troque a senha, revogue a API key) — reescrever histórico é secundário. Chave vazada em repo público é varrida por bots em minutos.

---

## 10. Estrutura do repositório

```
doAPS/
├─ .githooks/pre-commit          # gitleaks
├─ .github/workflows/ci.yml      # typecheck + test + gitleaks
├─ docs/
│  └─ ARQUITETURA.md             # este documento
├─ src/
│  ├─ config/
│  │  ├─ env.ts                  # schema Zod + parse (falha rápido)
│  │  └─ selectors.ts            # TODO seletor Moodle centralizado aqui
│  ├─ core/
│  │  ├─ browser.ts              # factory de context: locale, tz, UA, storageState
│  │  ├─ humanize.ts             # delays lognormais, digitação, leitura
│  │  ├─ logger.ts               # pino + redaction
│  │  ├─ retry.ts                # backoff exponencial
│  │  └─ errors.ts               # erros de domínio tipados
│  ├─ moodle/
│  │  ├─ auth.ts                 # [1] login, valida/renova sessão
│  │  ├─ courses.ts              # [2] /my/courses.php
│  │  ├─ sidebar.ts              # [3] varredura APS
│  │  └─ quiz.page.ts            # [4][5][9] view, start, summary, submit
│  ├─ extraction/
│  │  ├─ extract-questions.ts    # [6] DOM → Question[]
│  │  ├─ normalize.ts            # forma canônica + SHA-256
│  │  └─ images.ts               # download + downscale (sharp)
│  ├─ ai/
│  │  ├─ types.ts                # Question, Answer (Zod)
│  │  ├─ prompt.ts               # system estável | user volátil
│  │  ├─ cache.ts                # node:sqlite por hash (comum aos provedores)
│  │  ├─ router.ts               # effort por tipo de questão
│  │  └─ providers/              # [7] IA atrás de uma interface
│  │     ├─ types.ts             # interface Solver
│  │     ├─ anthropic.ts         # claude-opus-5 · messages.parse
│  │     ├─ gemini.ts            # gemini-3.8-flash · responseSchema
│  │     └─ index.ts             # fábrica lê AI_PROVIDER
│  ├─ filling/
│  │  ├─ fill-choice.ts          # [8] radio / checkbox
│  │  ├─ fill-text.ts            # [8] textarea + TinyMCE
│  │  └─ index.ts
│  ├─ runner/
│  │  ├─ pipeline.ts             # orquestra [1]..[10]
│  │  └─ state.ts                # idempotência / retomada
│  ├─ report/render.ts           # [10]
│  └─ cli.ts                     # parseArgs, modos dry-run/offline/submit
├─ eval/
│  ├─ run-eval.ts                # §7.7 — compara provedores contra gabarito
│  └─ answer-key.json            # (gitignored) gabarito de APS já corrigidas
├─ tests/
│  ├─ fixtures/                  # (gitignored) HTML real capturado
│  └─ unit/
│     ├─ extract.spec.ts         # contra fixtures — o teste que mais importa
│     ├─ normalize.spec.ts
│     └─ humanize.spec.ts
├─ .env.example                  # versionado, sem valores
├─ .gitignore
├─ package.json
├─ tsconfig.json
└─ README.md
```

`selectors.ts` centralizado é deliberado: quando a UniEVANGÉLICA atualizar o Moodle e algo quebrar, o conserto é em um arquivo, não espalhado por dez.

---

## 11. Caminho alternativo: a API do Moodle (documentado, não adotado)

A sondagem #8 revelou algo que vale registrar. O Web Service móvel do Moodle está **habilitado** neste servidor. Isso significa que existe um caminho sem navegador nenhum:

```
POST /login/token.php?username=…&password=…&service=moodle_mobile_app  → token
POST /webservice/rest/server.php  com  wsfunction=mod_quiz_get_attempt_data
                                        mod_quiz_process_attempt
```

Seria **muito** mais simples e rápido: JSON estruturado em vez de scraping, sem browser, sem seletor para quebrar.

**Não vamos por aí**, por três razões:

1. **O desafio proposto é automação de navegador.** Trocar por chamadas REST descaracteriza o exercício.
2. **Assinatura no log.** Requisições via web service aparecem de forma distinta no log do Moodle e criam registro em `mdl_external_tokens`. Menos discreto que uma sessão de navegador normal, não mais.
3. **Não verificado.** Confirmei que o endpoint de token responde; **não** confirmei que um token de aluno tem permissão para `mod_quiz_process_attempt`. Muitas instalações restringem as funções expostas. Isso continua sendo uma hipótese.

Fica registrado como plano de contingência caso o DOM se mostre inviável.

---

## 12. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| **Queimar as 2 tentativas depurando** | Alta | Modo `--offline` + fixtures. Nunca desenvolver contra tentativa ao vivo. |
| Alternativas embaralhadas entre tentativas | Alta | Mapear sempre `key → inputValue` lido do DOM daquela tentativa. Nunca assumir "3ª opção = C". |
| IA erra questão técnica | Média | `confidence` no schema + relatório de revisão. Padrão em `--dry-run`: você confere antes de enviar. |
| TinyMCE ignora `fill()` | Média | `frameLocator()` no iframe do editor. Tarefa dedicada na Fase 4. |
| Atualização do Moodle quebra seletor | Média | `selectors.ts` centralizado + teste de smoke contra fixture. |
| Sessão expira no meio (4h) | Baixa | Detectar redirect para `/login/` e refazer login transparente. |
| Rate limit / 5xx | Baixa | Backoff exponencial, respeitar `Retry-After`. |
| Questão de tipo não suportado (`match`, `ddwtos`) | Baixa | Pular explicitamente, marcar no relatório como "responder manualmente". Nunca chutar. |

---

## 13. Roadmap

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0** | Esqueleto: repo, TS, `.gitignore`, `.env.example`, hook gitleaks, CI | `git status` limpo, hook barra segredo de teste |
| **1** | `auth.ts` + `browser.ts` + `storageState` | Loga e reusa sessão sem relogar |
| **2** | `courses.ts` + `sidebar.ts` | Lista todas as APS das 5 disciplinas com cmid |
| **3** | `quiz.page.ts` triagem + **captura de fixtures** | HTML real salvo; nenhuma tentativa enviada |
| **4** | `extract-questions.ts` + testes offline | Testes passam contra fixture; todos os tipos cobertos |
| **5** | `providers/` (Claude + Gemini) + cache + prompt caching | `cache_read_input_tokens > 0` na 2ª execução |
| **5b** | `eval/run-eval.ts` — bake-off entre provedores | Acerto medido nos dois; escolha registrada com dados |
| **6** | `filling/` incluindo TinyMCE | `--dry-run` preenche 100% e não envia |
| **7** | `submit` + `humanize` + relatório | Envio sob confirmação; piso de tempo respeitado |

A Fase 3 é o marco crítico: a partir dela todo o desenvolvimento acontece offline, com custo zero de tentativa.

---

## 14. Resumo

- **É viável.** O alvo é Moodle: DOM estável, sem CAPTCHA, sem MFA, sem WAF. Verificado, não suposto.
- **Custo não é o problema.** Um semestre inteiro no modelo mais caro < R$ 20. Otimize para precisão; a economia de tokens vem de brinde.
- **Nenhuma assinatura sua cobre a API.** Claude Pro e Google AI Pro são ambos separados — no Google, a cota do plano vale *só* dentro do AI Studio web. O único caminho gratuito real é o free tier da Gemini API, cujo preço não é dinheiro: é o seu conteúdo virar dado de treino.
- **A escolha do provedor se decide medindo.** Claude e Gemini ficam atrás da mesma interface, e as fixtures viram conjunto de avaliação com gabarito real.
- **O recurso escasso são as 2 tentativas.** A arquitetura inteira gira em torno de fixtures + modo offline para nunca depurar ao vivo.
- **A IA faz uma coisa só:** recebe enunciado + alternativas, devolve uma letra com nível de confiança. Todo o resto é código determinístico.
- **Segredos:** `.gitignore` + redaction no logger + gitleaks no pre-commit e no CI. E atenção especial ao `state.json`, que vale tanto quanto sua senha.

---

### Anexo — fingerprint técnico do alvo

```
Plataforma      Moodle (tema Snap / Open LMS)
Servidor        Apache · HSTS · sem CDN/WAF
Idioma          pt_br · timezone América/São_Paulo
Sessão          MoodleSession (Secure, HttpOnly) · timeout 14400s (4h)
Login           POST /login/index.php
                campos: logintoken (CSRF) + username + password
                sem CAPTCHA · sem MFA · sem SSO/OAuth2
Router de API   M.cfg.apibase = /r.php/api   (Moodle 4.5+/5.x)
Web Service     /login/token.php ATIVO para service=moodle_mobile_app
Quiz            /mod/quiz/view.php?id=<cmid>
                /mod/quiz/attempt.php?attempt=<id>&page=<n>
                /mod/quiz/summary.php?attempt=<id>
Questões        div.que.<qtype> › .qtext | .answer .r0/.r1 › input[name^="q"]
```
