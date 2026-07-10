---
type: plan
name: Spec 006 - Logging seguro e estruturado
description: Implementar logging seguro conforme docs/specs/006-secure-structured-logging.md
planSlug: spec-006-secure-structured-logging
summary: "Sanitizar segredos no filtro de excecao, registrar falhas de streaming, trocar appendFileSync por sink assincrono com rotacao, e cobrir com testes sem depender de JEST_WORKER_ID."
spec: ../../docs/specs/006-secure-structured-logging.md
agents:
  - type: "security-auditor"
    role: "Garantir que nenhum segredo vaze em logs"
  - type: "backend-specialist"
    role: "Implementar sink assincrono e wiring do logging"
  - type: "test-writer"
    role: "Cobrir sanitizacao, escrita e fallbacks"
phases:
  - id: "phase-1"
    name: "Discovery & Alignment"
    prevc: "P"
    summary: "Confirmar padroes de segredo a mascarar e estrategia de sink assincrono."
    deliverables:
      - "Lista de padroes de segredo (bearer, api key, authorization, url com token)"
      - "Decisao: sink async com buffer + rotacao por tamanho"
    steps:
      - order: 1
        description: "Mapear onde segredos podem entrar (exception.message, exception.stack, req.url)"
        assignee: "security-auditor"
        deliverables:
          - "Inventario de fontes de vazamento"
      - order: 2
        description: "Definir contrato do sink (async, best-effort, shutdown limpo, rotacao)"
        assignee: "backend-specialist"
        deliverables:
          - "Interface do sink acordada"
  - id: "phase-2"
    name: "Implementation & Iteration"
    prevc: "E"
    summary: "Implementar sanitizacao, registro de falha de streaming e sink assincrono."
    deliverables:
      - "Sanitizador aplicado no openai-exception.filter.ts"
      - "Log de erro no caminho de falha de streaming"
      - "Sink assincrono com rotacao substituindo appendFileSync"
      - "Injecao de dependencia removendo o acoplamento a JEST_WORKER_ID"
    steps:
      - order: 1
        description: "Criar sanitizador e aplicar a message/stack antes de persistir (filter.ts)"
        assignee: "security-auditor"
        deliverables:
          - "Nenhum segredo persistido a partir de excecao"
      - order: 2
        description: "Registrar erro pos-primeiro-chunk no controller de streaming com requestId e categoria"
        assignee: "backend-specialist"
        deliverables:
          - "Falha de streaming distinguivel de sucesso"
      - order: 3
        description: "Substituir appendFileSync por sink assincrono/bufferizado com rotacao por tamanho"
        assignee: "backend-specialist"
        deliverables:
          - "Sem I/O sincrono no caminho da requisicao"
      - order: 4
        description: "Tornar o sink injetavel para permitir testes sem depender de JEST_WORKER_ID"
        assignee: "backend-specialist"
        deliverables:
          - "Caminho de escrita real testavel"
  - id: "phase-3"
    name: "Validation & Handoff"
    prevc: "V"
    summary: "Provar os criterios de aceite da spec 006 com testes e verificacao de segredos."
    deliverables:
      - "Testes de sanitizacao, escrita, fallback e falha de streaming"
      - "lint + build + jest verdes"
    required_sensors:
      - "tests-passing"
    steps:
      - order: 1
        description: "Escrever testes cobrindo sanitizacao, injecao de log, fallback de serializacao e falha de streaming"
        assignee: "test-writer"
        deliverables:
          - "Cobertura dos criterios de aceite"
      - order: 2
        description: "Rodar npm run lint, npm run build e npm test; garantir zero segredos em logs"
        assignee: "test-writer"
        deliverables:
          - "Evidencia de suite verde e ausencia de segredos"
status: filled
scaffoldVersion: "2.0.0"
---

# Spec 006 — Logging seguro e estruturado (Plano)

> Implementa os requisitos de [docs/specs/006-secure-structured-logging.md](../../docs/specs/006-secure-structured-logging.md).

## Task Snapshot
- **Objetivo:** logging seguro por padrao — sem vazar segredos, com falhas registradas em todos os caminhos e sem bloquear o event loop.
- **Sinal de sucesso:** criterios de aceite da spec 006 satisfeitos; `lint`, `build` e `jest` verdes; nenhum segredo em `gateway.log`.
- **Arquivos-alvo:**
  - `apps/gateway/src/common/errors/openai-exception.filter.ts` (sanitizar antes de persistir)
  - `apps/gateway/src/common/logging/log-file.ts` (sink async + rotacao + testabilidade)
  - `apps/gateway/src/common/logging/logging.interceptor.ts` (tipar `req.body`)
  - controller de streaming em `chat-completions` (registrar falha pos-chunk)

## Achados que originaram o plano
1. **Alta** — filtro grava `message`/`stack` crus: risco de vazar API key, `Authorization`, prompt.
2. **Media** — falhas mid-stream engolidas por `catch {}`: registradas como `status:200`.
3. **Media** — `appendFileSync` no caminho da requisicao bloqueia o event loop.
4. **Baixa** — crescimento ilimitado do log e guard so por `JEST_WORKER_ID` (cobertura zero).

## Working Phases

### Phase 1 — Discovery & Alignment (P)
Confirmar padroes de segredo a mascarar e fechar o contrato do sink assincrono (best-effort, shutdown limpo, rotacao por tamanho).

### Phase 2 — Implementation & Iteration (E)
1. Sanitizador aplicado a `message`/`stack` no filtro.
2. Log de erro no caminho de falha de streaming, distinguivel de sucesso.
3. Sink assincrono/bufferizado com rotacao substituindo `appendFileSync`.
4. Sink injetavel, removendo o acoplamento a `JEST_WORKER_ID`.

### Phase 3 — Validation & Handoff (V)
Testes de sanitizacao, escrita, fallback e falha de streaming; `lint` + `build` + `jest` verdes; verificacao explicita de ausencia de segredos em logs.

## Notas
- `.context/plans/**` e um artefato local (nao versionado no git) por padrao neste projeto.
- Para operar sob o harness PREVC, iniciar `workflow-init({ name: "spec-006-secure-structured-logging" })` e depois `plan link`.
