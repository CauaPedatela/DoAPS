# Como o doAPS funciona

Documento explicativo do sistema inteiro: o que cada parte faz, como o
navegador é controlado, o que é o Moodle por baixo, e — a parte mais
importante — **o que pode quebrar e por quê**.

Escrito para quem está começando em front-end. Nenhum conhecimento prévio
de Playwright ou Moodle é assumido.

---

## Parte 1 — O terreno

### 1.1 O que é uma página web, na prática

Quando você abre o AVA no navegador, três coisas chegam:

| | O que é | Analogia |
|---|---|---|
| **HTML** | a estrutura e o conteúdo | o esqueleto e os órgãos |
| **CSS** | as regras visuais | a roupa e a maquiagem |
| **JavaScript** | o comportamento | os músculos |

O HTML é uma árvore de elementos aninhados:

```html
<div class="que multichoice">          ← uma questão inteira
  <div class="qtext">Qual padrão…</div> ← o enunciado
  <div class="answer">
    <div class="r0">
      <input type="radio" value="0">    ← a bolinha clicável
      <div>a. Singleton</div>
    </div>
    <div class="r1">
      <input type="radio" value="1">
      <div>b. Strategy</div>
    </div>
  </div>
</div>
```

Essa árvore, já carregada na memória do navegador, chama-se **DOM**
(Document Object Model). É nela que o nosso programa trabalha.

**A distinção que sustenta o projeto inteiro:** o CSS pode mudar tudo o
que você *vê* — cor, fonte, posição, tamanho — sem alterar **uma vírgula**
do HTML. E o nosso robô não olha para o visual. Ele olha para o HTML.

Guarde essa frase, porque ela é a resposta para metade das suas perguntas
sobre risco de quebra.

### 1.2 O que é o Moodle, de fato

O Moodle é um **LMS** (Learning Management System) — um sistema de gestão
de aprendizagem. É software livre, escrito em PHP, criado em 2002, e hoje
roda em dezenas de milhares de instituições no mundo.

Isso importa por um motivo prático: **a UniEVANGÉLICA não escreveu esse
sistema.** Ela instalou o Moodle e configurou. O que significa que:

- A estrutura HTML das páginas vem do **código do Moodle**, não da
  faculdade
- Essa estrutura é a mesma em qualquer Moodle do mundo, na mesma versão
- Ela é **documentada e pública** — o código-fonte está no GitHub

Nós não estamos fazendo engenharia reversa de um site fechado. Estamos
programando contra uma estrutura conhecida e estável. É uma diferença
enorme de risco.

#### As três camadas do Moodle

```
┌─────────────────────────────────────────────────┐
│  TEMA (theme)                                   │  ← a faculdade escolhe
│  Cores, fontes, logo, disposição do menu.       │     aqui: tema "Snap"
│  Mexe no CSS e no "moldura" da página.          │
├─────────────────────────────────────────────────┤
│  PLUGINS / MÓDULOS                              │  ← quiz, fórum, tarefa
│  Cada tipo de atividade é um módulo.            │     `mod_quiz` é o nosso
├─────────────────────────────────────────────────┤
│  NÚCLEO (core)                                  │  ← o motor
│  Motor de questões, sessão, permissões.         │     estrutura estável
└─────────────────────────────────────────────────┘
```

**Essa separação é a nossa maior proteção**, e vou voltar nela na Parte 4.

O motor de questões (*question engine*) é núcleo. Ele gera o HTML de toda
questão de todo quiz de todo Moodle — e o tema **não reescreve** esse
HTML, só o pinta por fora.

#### O que descobrimos sondando o alvo

| Item | Achado |
|---|---|
| Plataforma | Moodle com tema **Snap** |
| Servidor | Apache, sem CDN nem WAF na frente |
| Login | POST comum com token CSRF (`logintoken`) |
| CAPTCHA / MFA | **nenhum** |
| Sessão | cookie `MoodleSession`, dura **4 horas** |
| Idioma / fuso | `pt_br` / América/São_Paulo |

Nada disso foi suposto: cada linha foi verificada com requisição real
antes de escrevermos código.

---

## Parte 2 — Como o navegador é controlado

### 2.1 O que o Playwright é

O Playwright é uma biblioteca que **dirige um navegador de verdade** por
programa. Não é um simulador: é o Chrome real, o mesmo que você usa,
abrindo as mesmas páginas e rodando o mesmo JavaScript.

```typescript
const navegador = await chromium.launch({ channel: 'chrome' });
const pagina = await navegador.newPage();
await pagina.goto('https://avagrad.unievangelica.edu.br');
await pagina.locator('#username').fill('2420076');
await pagina.locator('#loginbtn').click();
```

Lê-se quase como português: abra, navegue, preencha, clique.

No nosso projeto usamos `channel: 'chrome'`, que dirige o **Chrome já
instalado na sua máquina** em vez de baixar um navegador próprio. Duas
vantagens: nada para baixar, e a impressão digital do navegador é a de um
Chrome real.

### 2.2 Localizadores: como achamos um elemento

Este é o **coração da fragilidade** de qualquer automação, então vale
entender bem.

Para clicar num botão, o programa precisa dizer *qual* botão. Isso se faz
com um **seletor CSS** — a mesma linguagem que o CSS usa para escolher o
que estilizar.

| Seletor | Significa | Exemplo real nosso |
|---|---|---|
| `#username` | elemento com `id="username"` | campo de login |
| `.qtext` | elemento com `class="qtext"` | enunciado da questão |
| `div.que` | `<div>` com classe `que` | container da questão |
| `[data-for="cm"]` | atributo `data-for` valendo `cm` | item da barra lateral |
| `input[value="2"]` | input cujo `value` é `2` | a alternativa C |

**Nem todo seletor tem a mesma qualidade.** Esta é a lição central do
documento:

```
MAIS ESTÁVEL
    │
    │  1. Atributos de dados semânticos   [data-for="cm_completion"]
    │     Existem para a máquina ler. Ninguém muda por estética.
    │
    │  2. IDs e classes do NÚCLEO         div.que  .qtext  #username
    │     Vêm do motor do Moodle. O tema não os reescreve.
    │
    │  3. Estrutura de parentesco         .answer > div
    │     Sobrevive a mudança de cor, quebra se reorganizarem o HTML.
    │
    │  4. Classes de aparência            .btn-primary  .mb-0
    │     Bootstrap/tema puro. Mudam ao trocar o visual.
    │
    │  5. TEXTO VISÍVEL                   "Enviar tudo e terminar"
    ▼     Quebra se traduzirem, renomearem ou ajustarem a frase.
MAIS FRÁGIL
```

Nosso código fica quase todo nos níveis 1 e 2. O nível 5 aparece **uma
vez só**, e vou explicar o porquê na Parte 4.

### 2.3 Por que não usamos coordenadas de tela

Existe automação que funciona por posição: "clique no pixel (340, 210)".
Isso quebra se a janela mudar de tamanho, se a fonte for outra, se houver
um banner a mais no topo.

O Playwright não trabalha assim. Ele pergunta ao DOM *onde está o
elemento com esse seletor* e clica nele, esteja onde estiver. Redimensionar
a janela, mudar o tema, aumentar a fonte — nada disso afeta.

### 2.4 A espera automática

Páginas modernas montam conteúdo depois de carregar. Se você clicar rápido
demais, o botão ainda não existe.

O Playwright espera sozinho: `.click()` aguarda o elemento aparecer, ficar
visível e ficar clicável, até um limite de tempo.

**Mas essa espera não cobre tudo — e nós aprendemos na prática.** A
primeira execução salvou uma página de 13KB sem nenhuma questão: o
`domcontentloaded` avisa que o HTML *inicial* chegou, não que o conteúdo
montado por JavaScript apareceu. A extração viu página vazia, o laço de
páginas encerrou achando que o quiz tinha acabado, e o resultado foi "0
questões" num quiz de 10.

A correção virou uma função explícita:

```typescript
// aguardarQuestoes() — espera a primeira div.que existir de fato
await page.locator('div.que').first().waitFor({ state: 'attached' });
```

Lição: **espere pelo conteúdo que você precisa, não por um evento genérico
de carregamento.**

---

## Parte 3 — A arquitetura

### 3.1 O princípio

> A IA não navega, não decide e não clica.
> Ela recebe o texto de uma questão e devolve uma letra.

Todo o resto — login, varredura, extração, preenchimento, envio — é código
determinístico: dada a mesma entrada, produz sempre a mesma saída.

Isso não é preciosismo. É o que torna o sistema **depurável**. Quando algo
dá errado, você sabe se foi o código (reproduzível, corrigível) ou a IA
(a única parte que "opina").

```
┌──────────────── CÓDIGO DETERMINÍSTICO ────────────────┐
│                                                        │
│  login → lista disciplinas → varre APS → triagem       │
│                                          ↓             │
│                                    abre tentativa      │
│                                          ↓             │
│                              extrai questões do DOM    │
│                                          ↓             │
│              ╔═══════════════════════════════════╗     │
│              ║   IA: questão → letra + confiança ║     │
│              ╚═══════════════════════════════════╝     │
│                                          ↓             │
│                          preenche → envia → relatório  │
└────────────────────────────────────────────────────────┘
```

### 3.2 As pastas e o que cada uma responde

```
src/
├── config/      "quais são as regras e onde ficam as coisas?"
├── core/        "ferramentas de uso geral"
├── moodle/      "como converso com o Moodle?"
├── extraction/  "como transformo HTML em dados?"
├── ai/          "como pergunto à IA?"
├── filling/     "como escrevo a resposta na tela?"
├── runner/      "quem coordena tudo isso?"
└── daemon.ts    "quem dispara no horário?"
```

Cada pasta tem **uma** responsabilidade. Isso não é enfeite: quando o
Moodle mudar, você vai saber exatamente onde mexer.

### 3.3 Arquivo por arquivo

#### `src/config/` — as regras

| Arquivo | O que faz |
|---|---|
| `env.ts` | Lê o `.env` e **valida**. Se faltar a chave de API ou a senha estiver vazia, o programa morre no boot com mensagem clara — em vez de descobrir isso no meio de uma prova. Também relê o arquivo em runtime, para o agendador ser ajustável sem reiniciar. |
| `selectors.ts` | **Todos os seletores do Moodle vivem aqui.** Quando o layout mudar, o conserto é neste arquivo, não espalhado por dez. |

Centralizar seletores é a decisão de arquitetura mais importante para
resistir a mudanças. Volto nisso na Parte 4.

#### `src/core/` — ferramentas

| Arquivo | O que faz |
|---|---|
| `browser.ts` | Abre o Chrome com idioma pt-BR, fuso de São Paulo e tamanho de janela plausível. Salva a sessão em `.auth/state.json` para não relogar toda hora. |
| `humanize.ts` | Pausas com aparência humana. Detalhe: a distribuição é **lognormal**, não uniforme — pessoas têm muitas pausas curtas e algumas longas; um `random()` retangular seria, ele próprio, uma assinatura. |
| `logger.ts` | Registro de eventos com **redaction**: senha e chave de API nunca aparecem no log, mesmo que alguém as passe por engano. |
| `retry.ts` | Repete com espera crescente quando algo falha por rede ou sobrecarga. |
| `agenda.ts` | Calcula o próximo horário de execução. |
| `doctor.ts` | Diagnóstico: mostra se a configuração está válida, sem imprimir os valores secretos. |
| `verificar.ts` | Relê uma tentativa no Moodle e confere o que **de fato** foi salvo. |
| `notas.ts` | Boletim com a nota de cada APS. |
| `browser-check.ts` | Confere se o ambiente funciona, sem usar credenciais. |

Sobre `verificar.ts`, vale explicar por que existe. Numa execução, o
relatório disse **"10/10 preenchidas"** quando **nenhuma** resposta havia
sido gravada. "Preenchida" só significava que o clique não deu erro.

E há uma armadilha específica do Moodle: ele mantém um `<input
type="radio" value="-1">` **invisível e marcado por padrão**, significando
"sem resposta". Uma verificação ingênua conta esse sentinela como resposta
e produz um falso positivo perfeito.

> **Lição geral:** o relatório de quem executou não serve como prova.
> Verificação precisa ser independente.

#### `src/moodle/` — a conversa com o Moodle

| Arquivo | O que faz |
|---|---|
| `auth.ts` | Login. Confirma sucesso lendo `M.cfg.userId` do JavaScript da página — número, não texto, então independe de tema e idioma. **Não repete em senha errada**: tentativas seguidas bloqueiam a conta. |
| `courses.ts` | Lista as disciplinas em `/my/courses.php`. |
| `sidebar.ts` | Varre o índice do curso procurando `APS NN` e lê o estado de conclusão. |
| `triage.ts` | Lê prazo, tentativas usadas e permitidas. **Somente leitura** — não consome nada. É o portão que decide se vale abrir. |
| `attempt.ts` | Ciclo de vida da tentativa: abrir, navegar páginas, salvar fixture, enviar. |

#### `src/extraction/` — HTML vira dados

| Arquivo | O que faz |
|---|---|
| `extract.ts` | Converte `div.que` em objetos com enunciado, alternativas e imagens. Descarta HTML, CSS e navegação — sobra ~3% do original. |
| `normalize.ts` | Forma canônica do texto + hash SHA-256, usado como chave de cache. |
| `images.ts` | Baixa imagens pela sessão autenticada, reduz para 768px e guarda em cache. |

**Um detalhe que vale ouro** e que só se descobre olhando HTML real:

O Moodle tem um filtro TeX que transforma fórmulas em **imagens PNG**, com
o texto original no atributo `alt`. Mandar essas imagens para a IA seria
caro e pior — o `alt` já entrega o texto exato. Então o código separa:
imagem de verdade vai para a visão, imagem do filtro TeX vira texto.

**O detalhe mais perigoso do projeto inteiro** também mora aqui:

```typescript
// A letra mostrada NUNCA é o valor que o Moodle espera.
alternativas: [
  { letra: 'A', inputValue: '0', texto: 'Singleton' },
  { letra: 'B', inputValue: '1', texto: 'Strategy'  },
]
```

O Moodle **embaralha a ordem das alternativas** entre tentativas. A "C"
de hoje não é a "C" de amanhã. Se o código pegasse a resposta "C" da IA e
clicasse na terceira bolinha, marcaria a alternativa errada **em silêncio**
— sem erro, sem aviso, só nota baixa.

Por isso a tradução `letra → inputValue` sempre sai do DOM *daquela*
tentativa.

#### `src/ai/` — a pergunta ao modelo

| Arquivo | O que faz |
|---|---|
| `types.ts` | Formato de questão e de resposta, validado por schema. |
| `prompt.ts` | Monta o texto. Com imagens, intercala cada figura logo após o enunciado a que pertence. |
| `cache.ts` | Guarda respostas por hash. Questão repetida custa zero. |
| `providers/gemini.ts` | Fala com o Gemini. Se o modelo estiver congestionado, cai para outro. |
| `providers/anthropic.ts` | Mesma interface, para Claude (não implementado ainda). |

Por que intercalar as imagens: numa APS com 12 imagens e 3 questões,
mandá-las soltas no fim obrigaria o modelo a adivinhar qual pertence a
qual. Intercalar elimina a ambiguidade.

A **cadeia de modelos** não é precaução teórica. Numa execução real o
`gemini-3.8-flash` devolveu erro 503 cinco vezes seguidas e a APS foi
abandonada **com a tentativa já aberta** — tentativa consumida, nada
respondido. O free tier satura por modelo, então insistir no mesmo não
resolve; cair para outro, sim.

#### `src/filling/` e `src/runner/`

`filling/index.ts` escreve a resposta: marca a bolinha certa (traduzindo
letra → `inputValue`) ou digita caractere a caractere em questões
discursivas.

`runner/executar.ts` coordena uma APS em três passos:

1. **Percorre e coleta** todas as páginas
2. **Resolve tudo numa única chamada** de IA
3. **Volta preenchendo**

Por que em três passos: o quiz de Data Science tinha 10 páginas com 1
questão cada. Resolver conforme navega seriam 10 chamadas repetindo a
mesma instrução 10 vezes. Com a coleta antes, é **uma chamada**. E, de
quebra, ler tudo antes de responder é o que uma pessoa faria.

`runner/varredura.ts` faz o ciclo completo: entra, varre todas as
disciplinas, tria e executa as aptas. Uma APS que falha **não derruba as
outras**.

---

## Parte 4 — O que pode quebrar

Esta é a parte que você pediu, e é onde vale mais atenção.

### 4.1 A pergunta central: mudança visual quebra o sistema?

**Na maioria dos casos, não.** E o motivo é a separação que vimos na
Parte 1: o CSS muda a aparência sem tocar no HTML.

Se a UniEVANGÉLICA amanhã:

| Mudança | Quebra? | Por quê |
|---|---|---|
| Trocar as cores do tema | **Não** | Só CSS. O HTML não muda. |
| Mudar a fonte | **Não** | Só CSS. |
| Reposicionar o menu | **Não** | Não usamos posição, usamos seletores. |
| Trocar o logo | **Não** | Irrelevante para nós. |
| Trocar o tema inteiro (Snap → outro) | **Provavelmente não** | O tema não reescreve o HTML das questões. Mas pode mexer na barra lateral. |
| Atualizar o Moodle de versão maior | **Talvez** | O núcleo pode mudar. É o risco real. |
| Traduzir o site para inglês | **Sim, em um ponto** | Ver 4.3. |

### 4.2 Sobre IDs — respondendo diretamente

Você perguntou se o Playwright lê pelos IDs, e se isso impede quebra.
A resposta tem nuance, e a nuance é o mais útil.

**Usamos IDs onde eles são estáveis.** `#username`, `#password`,
`#loginbtn` vêm do formulário de login do núcleo do Moodle. São os mesmos
em qualquer Moodle do planeta.

**Mas nem todo ID presta.** Encontramos este no botão de enviar:

```html
<button id="single_button6a9f3ee1b61167">Enviar tudo e terminar</button>
```

Esse `id` é **gerado a cada carregamento da página**. Usá-lo funcionaria
uma vez e falharia na seguinte. IDs só ajudam quando são *estáveis e
semânticos*.

**E frequentemente algo melhor que ID existe.** Veja o que usamos para ler
o estado de conclusão:

```html
<li data-for="cm" data-id="2886250">
  <span data-for="cm_completion" data-value="1">
```

Atributos `data-*` existem **para a máquina ler**. Ninguém os altera para
deixar a página mais bonita — alterá-los quebraria o próprio JavaScript do
Moodle. São o alvo mais seguro que existe.

### 4.3 O ponto frágil que aceitamos de propósito

Existe **um** lugar onde dependemos de texto visível:

```typescript
const ALVO = 'Enviar tudo e terminar';
const botao = page.getByRole('button', { name: ALVO, exact: true });
```

Isso quebra se o Moodle for traduzido ou a frase mudar. Por que aceitamos?

Porque a alternativa era pior. A página de resumo tem **botões-chamariz**:

```
"Enviar tudo e terminar"          ← o certo
"Enviar solicitação de contato"   ← widget de acessibilidade
"Enviar solicitação de contato"   ← e de novo, escondido
```

Um seletor frouxo como `button:has-text("Enviar")` casaria com os três. E
aqui clicar errado não tem desfazer. Entre "pode quebrar se traduzirem" e
"pode clicar no botão errado numa ação irreversível", escolhemos o
primeiro — porque quebrar é **barulhento** (erro na hora) e clicar errado é
**silencioso**.

> **Princípio:** prefira falhas ruidosas a falhas silenciosas.

### 4.4 O Moodle impede que mudem o layout?

Não impede, mas **restringe fortemente** — e é isso que nos protege.

Voltando às três camadas:

**Tema** é o que a faculdade realmente mexe. E o tema opera por CSS e por
*templates* de moldura: cabeçalho, menu, rodapé, cores. O tema **não
reescreve** o HTML que o motor de questões gera. Um `div.que` com `.qtext`
e `.answer` dentro sai igual no Snap, no Boost ou em qualquer outro.

Por isso nossos seletores de questão são os mais seguros do projeto, mesmo
sendo classes e não IDs.

**Plugins e núcleo** só mudam com atualização de versão do Moodle — algo
que a instituição faz raramente, em janelas planejadas, geralmente entre
semestres.

O que a faculdade **pode** fazer sem atualizar nada e nos afetaria:

- Trocar de tema (afeta a barra lateral, não as questões)
- Mudar o idioma do site (afeta o botão de envio)
- Ativar/desativar o rastreamento de conclusão (afeta a regra "só APS
  pendente")

### 4.5 O risco que já se materializou

O melhor argumento de que essa análise não é teórica: **já erramos
exatamente aqui**, duas vezes.

**Caso 1 — a classe que não existia.**

```typescript
// o que eu escrevi
document.querySelectorAll('table.quizattemptsummary tbody tr')
// o que a página tem
<table class="generaltable generalbox quizreviewsummary mb-0">
```

Resultado: a contagem devolvia **sempre zero**. E como a regra de segurança
era "só executa APS com zero tentativas", ela **nunca disparava** — uma APS
já entregue passava pelo portão como se fosse virgem. Eu acreditava ter
duas camadas de proteção; havia uma.

O que denunciou: uma inconsistência entre dois relatórios meus. A triagem
dizia "0/2 tentativas, intocada" numa APS que o boletim mostrava feita com
100%. Dois números que não podiam ser ambos verdade.

**Caso 2 — o sentinela invisível.**

O verificador contava o `radio value="-1"` (que o Moodle deixa marcado por
padrão) como se fosse resposta, e reportou "10 marcadas" quando havia
zero. O falso positivo era perfeito.

> **Lição das duas:** seletor errado não dá erro. Ele devolve lista vazia,
> ou o elemento errado, e o programa segue feliz. Por isso toda contagem
> importante precisa ser conferida contra uma fonte independente.

### 4.6 Como saber que quebrou, e como consertar

**Sinais de quebra**, do mais claro ao mais traiçoeiro:

| Sintoma | Provável causa |
|---|---|
| Erro de timeout ao clicar | Seletor não acha mais o elemento |
| "0 questões extraídas" | Estrutura da questão mudou |
| "nenhuma APS encontrada" | Barra lateral mudou |
| Login falha com credencial certa | Formulário mudou, ou apareceu MFA |
| **Números que não batem entre relatórios** | Seletor devolvendo vazio em silêncio |

O último é o mais importante e o mais fácil de ignorar.

**Diagnóstico, em ordem:**

```bash
npm run browser:check   # o ambiente e o login ainda funcionam?
npm start -- scan       # a varredura ainda acha as APS?
npm start -- triage     # a triagem ainda lê prazo e tentativas?
npm run notas           # os números batem com o que você vê no site?
```

**Conserto:** abra `src/config/selectors.ts`. Foi para isso que ele existe.
Compare com o HTML real (F12 → Inspecionar no navegador) e ajuste.

E as **fixtures** em `tests/fixtures/` são HTML real capturado: dá para
desenvolver o extrator offline, sem tocar em tentativa nenhuma.

### 4.7 Avaliação honesta do risco

| Cenário | Chance | Impacto | Dificuldade de consertar |
|---|---|---|---|
| Mudança de cor/fonte/layout visual | alta | **nenhum** | — |
| Troca de tema | média | baixo | 1 seletor da barra lateral |
| Atualização maior do Moodle | baixa (entre semestres) | médio | algumas horas com as fixtures |
| Site traduzido | muito baixa | baixo | 1 string |
| Ativarem CAPTCHA no login | baixa | **alto** | inviabiliza o login automático |
| Mudarem a estrutura da questão | muito baixa | alto | é núcleo do Moodle, muda raramente |

**Resumo:** o risco maior não é o layout. É uma atualização de versão do
Moodle. E mesmo essa é gerenciável, porque as fixtures permitem consertar
offline antes de rodar ao vivo.

---

## Parte 5 — O que aprendemos construindo

Coisas que só apareceram na execução real, e que valem como lição geral:

**Navegar por URL apaga o que foi preenchido.** O Moodle só grava a
resposta quando o formulário é submetido. Usar `page.goto()` para pular de
página descartava tudo — as 10 questões ficavam em `notyetanswered`. A
correção foi avançar clicando em "Próxima página".

**Retomar uma tentativa não abre na página 1.** O Moodle abre na última
página visitada. Assumir o contrário fez catalogar a questão 10 como se
fosse da página 0, e o preenchimento foi procurar um elemento que não
existia ali.

**"Não deu erro" não é "funcionou".** O caso do relatório 10/10 com zero
respostas gravadas.

**Um erro de medição pode ser pior que um erro de execução.** Um sistema
que reporta sucesso falso leva você a decidir errado com confiança.

**Distribuição uniforme é uma assinatura.** Delays aleatórios entre 1s e
5s formam um histograma retangular que não se parece com nada humano.

---

## Apêndice — Glossário

| Termo | O que é |
|---|---|
| **DOM** | A árvore de elementos da página, na memória do navegador |
| **Seletor CSS** | Expressão que escolhe elementos: `#id`, `.classe` |
| **LMS** | Sistema de gestão de aprendizagem — o Moodle é um |
| **cmid** | *Course Module ID* — identifica uma atividade no Moodle |
| **attempt** | Uma tentativa de responder um quiz |
| **CSRF token** | Valor único por sessão que impede envio de formulário forjado |
| **Fixture** | HTML real salvo em arquivo, para testar sem acessar o site |
| **Headless** | Navegador rodando sem janela visível |
| **Free tier** | Faixa gratuita de uso de uma API |
| **503** | Erro HTTP: servidor temporariamente indisponível |
