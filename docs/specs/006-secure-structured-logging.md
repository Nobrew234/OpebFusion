# Spec 006: Logging seguro e estruturado

## Status

Draft

## Objetivo

Definir os requisitos do subsistema de logging do gateway para que ele seja seguro por padrao, nao vaze segredos nem dados do usuario, registre falhas de forma confiavel em todos os caminhos de resposta e nao degrade o event loop sob carga.

Esta spec formaliza o subsistema introduzido em `apps/gateway/src/common/logging` (`log-file.ts`, `logging.interceptor.ts`) e o registro de excecao em `apps/gateway/src/common/errors/openai-exception.filter.ts`. Ela precede e da base concreta para os requisitos mais amplos de observabilidade da [Spec 008](./008-observability-resilience-security.md).

## Contexto

Um diagnostico do subsistema atual identificou quatro problemas que precisam de contrato explicito:

1. O filtro de excecao grava `exception.message` e `exception.stack` crus. Erros de provider frequentemente embutem a URL com token na query, fragmentos do header `Authorization` ou conteudo do prompt do usuario. Qualquer pessoa com acesso ao arquivo de log pode ler credenciais upstream e dados de usuario.
2. Falhas no meio de uma resposta em streaming sao engolidas por um `catch` vazio no controller, o stream e encerrado e a requisicao e registrada como `request.completed` com `status:200`. Uma requisicao que morreu no meio fica indistinguivel de um sucesso.
3. A escrita usa `appendFileSync` no caminho da requisicao. Cada escrita bloqueia o event loop ate o disco responder, serializando requisicoes concorrentes atras da latencia de fsync.
4. O arquivo de log cresce sem limite nem rotacao, e o subsistema nao tem cobertura de teste porque o unico caminho executado sob Jest e o `no-op` guardado por `JEST_WORKER_ID`.

## Termos

- Sink de log: componente responsavel por persistir uma entrada de log estruturada.
- Entrada de log: registro estruturado em JSON de uma linha, com campos fixos e sem quebras de linha internas.
- Sanitizacao: remocao ou mascaramento de segredos e dados sensiveis antes da persistencia.
- Caminho de streaming: resposta SSE em que chunks ja podem ter sido emitidos ao cliente.

## Requisitos

### Sanitizacao obrigatoria

1. Nenhuma entrada de log pode conter API keys, bearer tokens, headers `Authorization` ou credenciais de provider, mesmo quando presentes em `message` ou `stack` de uma excecao.
2. O filtro de excecao deve passar `message` e `stack` por sanitizacao antes de persistir, aplicando a mesma disciplina que o interceptor ja segue ao registrar apenas metadados.
3. Prompts completos e respostas completas nao devem ser gravados por padrao em producao. Quando habilitados para depuracao, devem passar por sanitizacao e ser controlados por configuracao explicita.
4. A sanitizacao deve ocorrer antes da serializacao final, garantindo que o segredo nunca seja escrito em disco em nenhuma ramificacao.

### Registro de falhas em todos os caminhos

1. Falhas ocorridas apos o inicio de um stream devem gerar uma entrada de log de nivel `error` ou `warn`, distinta de uma conclusao bem-sucedida.
2. O controller de streaming nao pode engolir erros silenciosamente. Todo erro pos-primeiro-chunk deve ser registrado com `requestId`, categoria de falha e latencia antes do encerramento controlado do stream.
3. Uma requisicao encerrada por falha nao pode ser registrada com `status:200` sem sinal adicional que a distinga de sucesso.

### Escrita nao bloqueante

1. A persistencia de log nao pode bloquear o event loop no caminho da requisicao. O sink deve usar escrita assincrona ou bufferizada.
2. Uma falha ao escrever log nao pode derrubar a requisicao. O sink deve ser best-effort e capturar seus proprios erros.
3. O sink deve encerrar recursos pendentes de forma limpa no shutdown do processo, sem perder entradas ja aceitas.

### Integridade e injecao

1. Toda entrada deve ser serializada como JSON, garantindo escape de quebras de linha e neutralizando log injection via campos controlados pelo cliente (`path`, `model`).
2. Falha de serializacao, incluindo referencia circular, deve degradar para uma entrada minima valida, nunca lancar excecao no caminho da requisicao.

### Rotacao e retencao

1. O arquivo de log deve ter limite de tamanho e politica de rotacao configuravel, evitando crescimento ilimitado.
2. Entradas longas, como stacks, nao podem produzir linhas sem limite quando combinadas com o crescimento do arquivo.

### Testabilidade

1. O caminho real de escrita, a sanitizacao e os fallbacks de erro devem ser testaveis sem depender da variavel `JEST_WORKER_ID`.
2. O guard que evita poluir o log durante testes deve permitir que o comportamento de escrita seja exercitado por injecao de dependencia ou sink configuravel.

### Campos estruturados

Cada entrada persistida deve conter, no minimo:

- `requestId`;
- nivel (`info`, `warn`, `error`);
- evento (`gateway.boot`, `request.completed`, `request.failed`, `exception.caught`);
- metodo e rota publica quando aplicavel;
- status e latencia total quando aplicavel;
- modelo publico e flag de streaming quando aplicavel;
- erro normalizado quando houver.

Timestamps devem ser gravados em UTC de forma consistente.

## Criterios de aceite

- Nenhum segredo, bearer token ou header de autorizacao aparece em qualquer entrada de log, inclusive nas geradas a partir de `exception.stack`.
- Uma falha no meio de um stream produz uma entrada `error`/`warn` distinguivel de uma conclusao com sucesso.
- A escrita de log nao usa I/O sincrono no caminho da requisicao.
- Uma falha de escrita de log nao interrompe o processamento da requisicao.
- O arquivo de log respeita limite de tamanho e rotacao configurados.
- A sanitizacao e os caminhos de escrita e fallback possuem cobertura de teste sem depender de `JEST_WORKER_ID`.
- Log injection via `path` ou `model` e neutralizada por serializacao JSON.

## ADRs relacionados

- [ADR 0001](../adrs/0001-use-nestjs-backend.md)
- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0004](../adrs/0004-single-json-configuration.md)
