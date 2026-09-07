# doAPS

Automação de questionários **APS** no AVA (Moodle) da UniEVANGÉLICA, com
Playwright para navegação e um LLM restrito a uma única tarefa: ler uma
questão e devolver a alternativa.

> Projeto acadêmico, desafio proposto em sala. O fluxo é **determinístico
> por padrão** e não envia nada sem `--submit` explícito.

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

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

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
npm test
npm run typecheck
```

`scan` e `triage` são **somente leitura** — não iniciam tentativa, não
consomem nada. Só `run` abre tentativa.

### As três garantias

**1. Só mexe no que está pendente.** O estado de conclusão vem do próprio
índice do Moodle, não de heurística. O que já está feito é ignorado.

**2. Tentativa única exige liberação explícita.** As APS aqui têm 1 ou 2
tentativas — quase sempre 1. Com tentativa única, **iniciar já é o ponto
sem volta**, não enviar. Por isso não existe "reserva" numérica: existe um
portão, `--ultima-tentativa`, que obriga a decisão a ser consciente.

**3. Nada é enviado sem `--submit`.** O padrão preenche e deixa a tentativa
aberta (o Moodle salva rascunho sozinho) para você revisar no navegador.
Questões que a IA marcou como confiança baixa saem destacadas no relatório.

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

Fase 1 de 7. Feito: esqueleto, configuração validada, navegador,
ritmo humano, barreiras de segredo. Roadmap completo em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) §13.
