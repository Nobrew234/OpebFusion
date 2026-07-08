# AGENTS.md — Open Fusion

Instruções-base para qualquer agente de IA (Claude Code, Codex, Cursor, etc.) trabalhando neste repositório. Leia isto antes de qualquer alteração.

## O que é este projeto

Open Fusion é um gateway de LLMs exposto como API compatível com OpenAI (`/v1/chat/completions`, `/v1/models`). Um modelo orquestrador, configurado por rota, decide responder diretamente ou delegar subtarefas a outros modelos via uma tool interna (`delegate_llm`), segundo políticas declaradas em um único arquivo JSON. Backend em NestJS; chamadas de LLM, streaming e tool calling via Vercel AI SDK; OpenRouter é o primeiro provider oficial.

Estado atual: **spec 001 implementada**. O monorepo NestJS existe em `apps/gateway` (npm workspaces). A superfície HTTP compatível com OpenAI está pronta e testada: `POST /v1/chat/completions` (com e sem streaming), `GET /v1/models`, autenticação por bearer token, envelope de erro OpenAI-compatible e carregamento/validação da config JSON no boot. A orquestração real (spec 002+) ainda não existe — há um `FakeOrchestrationService` determinístico atrás do seam `OrchestrationService`, que deve ser substituído sem alterar controllers/DTOs. Rode `npm run build`, `npm test`, `npm run test:e2e` e `npm run lint` a partir da raiz.

## Leia antes de implementar qualquer coisa

- `docs/PRD.md` — visão geral, objetivos, não objetivos, escopo do MVP.
- `docs/adrs/0001` a `0007` — decisões arquiteturais (NestJS, contrato OpenAI-compatible, Vercel AI SDK, config JSON único, orquestrador LLM, OpenRouter, camada de provider adapters).
- `docs/specs/001` a `007` — especificação funcional de cada parte: API HTTP (001), orquestração/roteamento (002), config JSON (003), providers/OpenRouter (004), streaming/tools/normalização (005), streaming roteado com delegações internas (006), observabilidade/resiliência/segurança (007).

Specs e ADRs se referenciam entre si em vez de repetir decisões — pular o link "relacionados" é como se viola sem querer uma regra decidida em outro documento. Se um spec e uma implementação "mais limpa" conflitarem, ou se dois documentos parecerem se contradizer, pare e pergunte em vez de escolher uma leitura sozinho.

## Regras arquiteturais não negociáveis

Estas regras aparecem espalhadas em vários specs/ADRs porque atravessam quase toda mudança. Valem para qualquer feature, independente da spec sendo trabalhada:

- **Direção de dependência**: controller/DTO → serviço de orquestração → provider adapters → Vercel AI SDK. Nunca ao contrário; controllers nunca importam SDK de provider nem o Vercel AI SDK diretamente (ADR 0007).
- **Adapters isolam providers**: nenhum detalhe específico de provider vaza para orquestração ou controllers. Trocar de provider é configuração, não mudança de código fora do adapter.
- **`delegate_llm` é interno**: nunca aparece como tool escolhível pelo cliente, nunca é exposta no contrato público.
- **Conteúdo delegado é não confiável**: resultado de qualquer modelo delegado ou agente paralelo não pode sobrescrever instruções de sistema, política de rota ou limites de execução.
- **`streamFinalOnly`**: no stream público só trafega o alvo final (`delta.content`). Nenhum evento de delegação, tool call interna, prompt ou detalhe de grafo de execução chega ao cliente.
- **`maxDepth` é sempre `1`** no MVP — é um teto arquitetural, não um default configurável para cima. Agentes delegados não podem orquestrar recursivamente.
- **Segredos** (`apiKeyEnv`, tokens) só existem via referência `*Env` na config, resolvidos em runtime; nunca aparecem em logs, erros ou respostas.
- **Token do cliente do gateway nunca é repassado a um provider.** Credenciais de provider vêm só da config do servidor.
- **Falha antes do primeiro chunk** → erro HTTP no envelope OpenAI-compatible. **Falha depois do stream iniciado** → encerramento controlado do stream, sem vazar stack trace, segredo ou detalhe interno.

## Processo de desenvolvimento

- **TDD é o modo de trabalho padrão**: escreva o teste que falha antes do código que o faz passar (red), implemente o mínimo para passar (green), só então refatore (refactor). Os critérios de aceite e a seção "Expected Tests"/"Critérios de aceite" de cada spec são a definição de pronto — não é opcional cobri-los.
- **SOLID e DRY** guiam o refactor: cada classe com uma razão para mudar; novo provider/capability se adiciona sem reescrever código existente; qualquer "adapter" ou "modelo delegado" deve ser substituível pelo outro sem quebrar quem o usa; dependências via abstração/DI do NestJS, não import direto de concreto. DRY vale para conceito único que muda em um só lugar (ex: shape do envelope de erro) — não force deduplicação entre coisas que só parecem iguais hoje.
- Camadas de teste: **unit** para uma classe isolada (adapter, validador de config, lógica de classificação/grafo da orquestração com fakes), **integration** para wiring de módulo NestJS, **e2e** para o contrato HTTP público (`/v1/chat/completions`, `/v1/models`, SSE).
- Nunca faça chamada real a um provider de LLM em teste — fakeie a resposta do orquestrador/delegado de forma determinística.

## Convenções de configuração

- Um único arquivo JSON, caminho via `OPEN_FUSION_CONFIG` (fallback `./config/open-fusion.config.json`).
- Schema validado no boot; falha de config deve derrubar o boot com erro claro apontando o campo inválido — nunca subir parcialmente ou falhar só na primeira requisição.
- Campos de segredo terminam em `Env` e apontam para variável de ambiente, nunca o valor literal.

## Contrato público (resumo — ver spec 001/005/006 para detalhes)

Um cliente com SDK OpenAI deve funcionar trocando só `baseURL` e token. Envelope de resposta, mapeamento de erros (400/401/403/404/408/429/500/502/503), `finish_reason` (`stop`/`length`/`tool_calls`/`content_filter`) e streaming SSE (`chat.completion.chunk`, termina em `data: [DONE]`) seguem exatamente o formato Chat Completions da OpenAI. Qualquer desvio aqui quebra clientes reais, não só o teste que você está rodando.

## Skills disponíveis para Claude Code

Este repositório tem skills em `.claude/skills/` com o detalhamento operacional de cada tópico acima. Um agente rodando em Claude Code deve invocá-las pelo nome quando a tarefa combinar:

| Skill | Quando usar |
|---|---|
| `openfusion-implement-spec` | Implementar qualquer feature ligada a um spec/ADR do projeto. |
| `openfusion-tdd-workflow` | Conduzir o ciclo red-green-refactor para qualquer mudança de código. |
| `openfusion-solid-dry-design` | Projetar ou refatorar classes/módulos aplicando SOLID/DRY a esta arquitetura. |
| `openfusion-provider-adapter` | Adicionar ou alterar um provider adapter (OpenRouter ou novo). |
| `openfusion-config-schema` | Alterar o schema do `open-fusion.config.json` e sua validação. |
| `openfusion-routing-engine` | Mexer no orquestrador, `delegate_llm`, classificação de capability ou grafo de execução. |
| `openfusion-openai-contract` | Checar conformidade de request/response/streaming com o contrato OpenAI. |

Agentes em outras ferramentas (sem acesso a essas skills) devem seguir as regras deste AGENTS.md diretamente — o conteúdo das skills é um detalhamento das mesmas regras, não informação adicional obrigatória.

## Quando algo for ambíguo

Não escolha uma interpretação em silêncio. Aponte a seção específica do spec/ADR em conflito e as leituras possíveis, e pergunte antes de construir em cima da leitura errada.
