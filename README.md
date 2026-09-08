# doAPS

Automação de questionários **APS** no AVA (Moodle) da UniEVANGÉLICA, com
Playwright para navegação e um LLM restrito a uma única tarefa: ler uma
questão e devolver a alternativa.

> Projeto acadêmico, desafio proposto em sala. O fluxo é **determinístico**:
> a IA só decide a alternativa; navegação, extração e envio são código.

## Princípio

A IA **não navega, não decide e não clica.** Ela recebe enunciado e
alternativas em texto puro e devolve uma letra com nível de confiança.
Login, varredura, extração, preenchimento e envio são todos código.

```
auth → discover → scan → triage → attempt → extract
                                               ↓
                                    [ IA: questão → letra ]
                                               ↓
                                    fill → submit → report
```

Como tudo funciona, arquivo por arquivo, e o que pode quebrar:
[`docs/COMO-FUNCIONA.md`](docs/COMO-FUNCIONA.md).
Decisões de projeto e viabilidade: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Requisitos

- **Node.js ≥ 24** (roda TypeScript nativamente — sem build)
- **Google Chrome** instalado (o projeto dirige o Chrome do sistema)

## Instalação

```bash
npm install
cp .env.example .env    # preencha suas credenciais
npm run browser:check   # valida o ambiente, sem usar credenciais
```

## Uso

```bash
npm start -- scan                  # APS pendentes (não mostra as já feitas)
npm start -- scan --todas          # inclui as concluídas
npm start -- triage                # prazo e tentativas de cada pendente
npm start -- run --cmid 2886430    # EXECUTA: preenche, não envia
npm start -- run --cmid X --submit # executa E envia
npm run verificar -- <attempt> <cmid>   # confere o que foi salvo
npm run notas                      # boletim: nota de cada APS
npm run eval                       # mede a IA contra gabarito conhecido
npm test
npm run typecheck
```

`scan` e `triage` são **somente leitura** — não iniciam tentativa, não
consomem nada. Só `run` abre tentativa.

### Agendador

```bash
npm run daemon                 # executa JÁ e depois entra no loop diário
npm run daemon -- --so-agendar # pula a execução inicial, só agenda
npm run daemon -- --uma-vez    # executa uma vez e encerra
```

Ao subir, ele **executa na hora** — é quando você está olhando a tela — e
só depois entra na espera do horário diário.

Controlado por `DAEMON_HORA` (padrão `07:20`) e `DAEMON_SUBMIT` no `.env`.
Com `HEADED=true` você acompanha o navegador trabalhando.

O laço recalcula o próximo horário a cada volta, então continua correto
mesmo se a máquina dormir. Um erro num dia não derruba o agendador.

#### Rodando pelo IntelliJ

Run/Debug Configurations → **+** → **npm**:

| Campo | Valor |
|---|---|
| Name | `daemon` |
| package.json | `<projeto>/package.json` |
| Command | `run` |
| **Scripts** | `daemon` |

O campo **Scripts** é obrigatório — vazio produz o erro *"Please specify
npm scripts to run"*. `Command` é o verbo do npm (`run`), `Scripts` é
qual script executar (`daemon`).

### As três garantias

**1. Só toca em APS intocada.** O robô executa apenas o que tem **zero
tentativas concluídas**. Se você já fez alguma tentativa, ela não é
refeita — nem que ainda sobrem tentativas. Em compensação, uma APS que
ninguém começou é executada mesmo tendo uma única tentativa.

Uma tentativa **em andamento** é exceção: ela é retomada, não recomeçada.
Normalmente é uma execução nossa que caiu no meio.

**2. Nada é enviado por acidente.** No CLI, envio exige `--submit`. No
agendador, exige `DAEMON_SUBMIT=true` — e aí o banner de início avisa em
letras claras e espera 5s antes de começar. Sem isso, o fluxo preenche e
deixa a tentativa aberta (o Moodle salva rascunho sozinho) para você
revisar no navegador.

**3. O relatório não é prova.** `preenchida: true` significa apenas que o
clique não deu erro — já aconteceu de reportar 10/10 com zero respostas
gravadas. Por isso existe `npm run verificar -- <attempt> <cmid>`, que
relê a tentativa no Moodle e confere o que de fato foi salvo, ignorando o
radio-sentinela `value="-1"` que o Moodle mantém marcado por padrão.

## Segurança

Este repositório é público. Nada sensível entra nele:

| Arquivo | Por quê |
|---|---|
| `.env` | credenciais e chaves de API |
| `.auth/state.json` | **cookie de sessão ativo** — vale como a sua senha por 4h |
| `tests/fixtures/` | HTML real com enunciados de prova e dados pessoais |
| `runs/`, `cache/` | respostas e histórico |

Três camadas de proteção: `.gitignore`, *redaction* no logger, e um hook de
pre-commit que bloqueia arquivos proibidos e padrões de segredo. O `npm
install` roda o script `prepare`, que ativa o hook via
`git config core.hooksPath .githooks` — então ele passa a valer para
qualquer clone, não só para a máquina onde foi criado.

A varredura de segredos do hook é própria e roda sempre; se você tiver
[gitleaks](https://github.com/gitleaks/gitleaks) instalado, ele entra como
camada extra.

> Se um segredo vazar em algum commit, **rotacione a credencial**.
> `.gitignore` não apaga histórico.

## Estado

Fluxo completo funcionando de ponta a ponta: login, varredura das
disciplinas, triagem, execução, envio e agendamento diário. Validado numa
APS real de 10 questões — **10/10, nota máxima** — com uma única chamada
de IA (~2.400 tokens) e as respostas conferidas por verificação
independente.

Questões com imagem funcionam e foram medidas contra gabarito real
(`npm run eval`): 13/13, sendo 9 delas com imagem — incluindo uma APS
em que as próprias alternativas são figuras sem texto algum.

Ainda **não exercitado**: questões discursivas. O código de digitação em
TinyMCE existe, mas nenhuma APS testada teve uma.
