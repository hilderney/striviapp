# Striviapp

> Pipeline modular em Node.js ÔÇö extrai PDFs, l├¬ planilhas, processa com LLMs e entrega tudo em uma interface web com autentica├º├úo JWT + 2FA TOTP, multi-tenant e suporte a MySQL.

---

## O que faz

| Capacidade | Detalhe |
|------------|---------|
| **Extração de PDF** | Scan → texto → `.xlsx` / `.csv` / `.pdf` (pdf planned) no layout escolhido |
| **Leitura de planilhas** | `.xlsx`, `.xls` (TSV latin-1), `.csv`, `.tsv` — mesmo registry de saída |
| **Processamento LLM** | Envia arquivos para Ollama (local) ou OpenRouter; resposta JSON + resumo |
| **Interface web** | SPA leve (HTML + JS vanilla) com 4 abas, drag-and-drop e file-browser |
| **Autentica├º├úo** | JWT access + refresh rotacionado + eleva├º├úo TOTP por opera├º├úo |
| **Multi-tenant** | Models, jobs e arquivos isolados por usu├írio (`output/<userId>/`) |
| **Assinatura** | Controle manual de expira├º├úo por usu├írio; ADM isento |
| **Persist├¬ncia** | SQLite (dev) ou MySQL (produ├º├úo Hostinger) ÔÇö mesmo contrato de adapter |
| **Logs** | NDJSON por sess├úo; aba dedicada para listar, filtrar, abrir e excluir |

---

## Requisitos

- **Node.js ÔëÑ 20 LTS**
- npm

```bash
npm install
```

---

## In├¡cio r├ípido

### Interface web (modo completo)

```bash
# 1. Configure as vari├íveis de ambiente
cp .env.example .env
# Edite .env: defina APP_SECRET_KEY, JWT_SECRET e BOOTSTRAP_ADMIN_PASSWORD

# 2. Suba o servidor
npm run start:web
```

Acesse `http://127.0.0.1:4000` ÔÇö a aplica├º├úo abre na tela de **login**.

No **primeiro boot** sem usu├írios cadastrados, um ADM seed ├® criado automaticamente com as credenciais `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` do `.env`. Ap├│s login, o sistema guia o cadastro do authenticator TOTP (Google Authenticator, Authy, etc.).

### CLI (Fase 1 ÔÇö s├│ PDFs)

```bash
npm start -- ./fixtures ./output
```

Gera `.txt`, `.csv` e `.xlsx` para cada PDF encontrado e sobe um servidor de links em `http://localhost:4000/files`.

---

## Interface web ÔÇö abas

Ap├│s autenticar, as abas dispon├¡veis dependem da role:

| Aba | Conte├║do | ADM | USER |
|-----|----------|:---:|:----:|
| **Arquivos** | Upload de PDF/planilha, processamento e download dos arquivos gerados | Ô£ô | Ô£ô |
| **Logs** | Listar, filtrar, visualizar e excluir logs NDJSON de sess├úo | Ô£ô | ÔÇö |
| **Modelos LLM** | CRUD de modelos Ollama e OpenRouter ÔÇö dados isolados por usu├írio | Ô£ô | Ô£ô |
| **Processar LLM** | Enviar `.txt` / `.csv` / `.xlsx` ├á LLM; resumo + link JSON | Ô£ô | Ô£ô |

---

## Pipeline de arquivos

### PDFs

```
PDF ÔöÇÔöÇÔû║ scanner ÔöÇÔöÇÔû║ extractor (.txt)
                          Ôöé
                    tableParser (linhas de tabela)
                          Ôöé
                    exporter → .xlsx / .csv / .pdf (layout unimed-report; pdf planned)
```

O layout `unimed-report` (default do registry; spec 03) inclui:

- Linha 1: nome do prestador
- Linha 2: `UNIMED — 1º PGTO PROGRAMADO PARA {data} … PRODUÇÃO: {início} A {fim}`
- Linha 3: cabeçalho com 11 colunas (`Requisição`, `Protocolo`, `Guia`, `Beneficiário`, `Atendimento`, `Executante`, `Serviço`, `Qt`, `Vl Bruto`, `Vl Glosa`, `Vl Pago`) — sem coluna `Item`
- Dados ordenados por Executante → Beneficiário
- Subtotal por Executante (`TOTAL - {NOME}`) e `TOTAL GERAL`
- **RESUMO GERAL** por valor de sessão com `VR.SESSÕES`, `QUANT.` e `TOTAL`
- XLSX com apresentação (cores, fontes, bordas, freeze); CSV só conteúdo; PDF de saída planned (ADR-022)
- Segundo padrão planned: `unimed-financial-resume` (spec 24). O usuário escolhe container (`xlsx`, `csv`, `pdf`) e padrão na aba Arquivos.

### Planilhas (`.xlsx` / `.xls` TSV / `.csv`)

Lidas pelo `spreadsheetReaderAdapter`, mapeadas pelo parser `unimed-planilha` e exportadas no layout pedido (default `unimed-report`) — incluindo valores monetários reais (`Vl Bruto`, `Vl Glosa`, `Vl Pago`), que no fluxo PDF ficam como placeholders.

---

## LLM ÔÇö Ollama e OpenRouter

Cada usu├írio mant├®m seu pr├│prio cat├ílogo de modelos (dados isolados por `user_id`):

```
POST /api/v1/llm/models
{
  "name": "Llama 3 local",
  "provider": "ollama",
  "modelId": "llama3",
  "baseUrl": "http://127.0.0.1:11434"
}

POST /api/v1/llm/models
{
  "name": "GPT-4o Mini",
  "provider": "openrouter",
  "modelId": "openai/gpt-4o-mini",
  "token": "sk-or-v1-..."
}
```

Tokens OpenRouter s├úo criptografados em repouso (AES-256-GCM) e **nunca retornam em texto puro** na API ÔÇö apenas `hasToken: true`.

Para processar:

```
POST /api/v1/llm/process
{
  "llmModelId": "<uuid>",
  "sourceFile": "relatorio.csv",
  "promptTemplate": "Analise os dados e retorne JSON com summary e insights[]."
}
```

Resposta: `{ jobId, status, responseFile, responseUrl, summary, usage }`.  
O arquivo `.json` gerado fica em `output/<userId>/` e ├® acess├¡vel via `/open/<filename>`.

---

## Autentica├º├úo e seguran├ºa

### Modelo de sess├úo

| Credencial | Dura├º├úo | Concede |
|------------|---------|---------|
| **Access JWT** | 15 min (configur├ível) | Sess├úo; abas conforme role |
| **Refresh token** (opaco, hash SHA-256 no banco) | 7 dias | Renova o access de forma transparente; rotacionado a cada uso |
| **Elevation token** (TOTP 6 d├¡gitos / 30 s) | 15 min | Processar e ler arquivos; expirado ÔåÆ pede novo c├│digo sem deslogar |

### Fluxo

```
Login (usu├írio + senha)
    Ôöé
    Ôö£ÔöÇÔû║ totpEnabled = false ÔåÆ modal de setup ÔåÆ cadastra no Authenticator ÔåÆ confirma
    Ôöé
    ÔööÔöÇÔû║ Acesso a arquivo/processamento
            Ôöé
            Ôö£ÔöÇÔû║ sem elevation token ÔåÆ 403 ELEVATION_REQUIRED ÔåÆ modal TOTP
            Ôöé
            Ôö£ÔöÇÔû║ access expira ÔåÆ refresh autom├ítico (transparente)
            Ôöé
            ÔööÔöÇÔû║ refresh expira/revogado ÔåÆ 401 ÔåÆ tela de login
```

### Roles

| Role | Abas | Escopo de dados |
|------|------|-----------------|
| `ADM` | Todas | Todos os usu├írios; isento de assinatura e expira├º├úo |
| `USER` | Arquivos, Modelos LLM, Processar LLM | Apenas pr├│prios models, jobs, `output/<userId>/` e `staging/<userId>/` |

O controle de acesso vive **no backend** (401 / 403) ÔÇö ocultar abas na UI ├® apenas UX.

### Trocar de authenticator

`POST /api/v1/auth/totp/setup` exige `{ "password": "..." }` quando o TOTP j├í est├í ativo. Sem a senha, a rota retorna `403 TOTP_REENROLL_DENIED` ÔÇö evitando que um access token roubado se auto-eleve registrando um novo authenticator.

### Pr├íticas de seguran├ºa implementadas

- Senhas com `scrypt` + salt ├║nico; compara├º├úo via `timingSafeEqual`
- Custo de hash constante para usu├írios inexistentes (sem or├ículo de timing)
- Refresh tokens armazenados s├│ como SHA-256; revogados a cada rota├º├úo
- Segredos TOTP e tokens OpenRouter: AES-256-GCM no banco
- JWTs HS256 com campo `kind` (`access` / `elevation`) ÔÇö tokens n├úo s├úo intercambi├íveis
- Eleva├º├úo amarrada ao `sub` do usu├írio
- Path traversal bloqueado em todas as rotas de arquivo
- Bind padr├úo em `127.0.0.1`
- Corpos HTTP limitados a 300 MB; extens├Áes e nomes de arquivo validados

---

## Multi-tenant e assinatura (Fase 6)

- Models e jobs filtrados por `user_id`; `get` / `update` / `delete` de outro usu├írio retorna 404
- Filesystem isolado: `output/<userId>/` e `staging/<userId>/`
- Assinatura manual ÔÇö sem gateway de pagamento:

```
PATCH /api/v1/auth/users/:id/subscription
{ "months": 3 }                          // prorroga a partir de hoje ou da data atual
{ "expiresAt": "2027-01-01", "plan": "anual", "status": "active" }  // expl├¡cito
```

- USER sem assinatura ativa ÔåÆ `403 SUBSCRIPTION_EXPIRED` em rotas de arquivo e LLM (login e `/auth/me` continuam)
- ADM sempre ativo, sem `subscription_expires_at`

---

## Vari├íveis de ambiente

Copie `.env.example` para `.env`. Todas s├úo opcionais em desenvolvimento (chaves ef├¬meras s├úo geradas com warning); **obrigat├│rias em produ├º├úo**:

| Vari├ível | Default | Descri├º├úo |
|----------|---------|-----------|
| `APP_SECRET_KEY` | gerada (ef├¬mera) | Chave AES-256 (hex 64 chars) para tokens e segredos TOTP |
| `JWT_SECRET` | gerada (ef├¬mera) | Chave de assinatura dos JWTs |
| `BOOTSTRAP_ADMIN_USER` | `admin` | Usu├írio ADM criado no primeiro boot |
| `BOOTSTRAP_ADMIN_PASSWORD` | `admin123` | **Troque imediatamente** |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Validade do access token (15 min) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Validade do refresh token (7 dias) |
| `ELEVATION_TTL_SECONDS` | `900` | Validade da eleva├º├úo TOTP (15 min) |
| `PERSISTENCE` | `sqlite` | `sqlite` ou `mysql` |
| `DB_PATH` | `./data/app.db` | Caminho do SQLite |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | ÔÇö | Credenciais MySQL (Hostinger) |
| `PORT` | `4000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Bind HTTP |
| `OUTPUT_DIR` | `./output` | Diret├│rio de sa├¡da |
| `LOGS_DIR` | `./logs` | Diret├│rio de logs NDJSON |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama local |

Gerar uma chave segura:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API REST ÔÇö refer├¬ncia r├ípida

Prefixo: `/api/v1` ┬À Autentica├º├úo: `Authorization: Bearer <accessToken>` ┬À Eleva├º├úo: `X-Elevation-Token: <elevationToken>`

### Autentica├º├úo

| M├®todo | Rota | Auth | Descri├º├úo |
|--------|------|------|-----------|
| `POST` | `/auth/login` | p├║blico | `{ username, password }` ÔåÆ tokens + user |
| `POST` | `/auth/refresh` | p├║blico | `{ refreshToken }` ÔåÆ novo par (rota├º├úo) |
| `POST` | `/auth/logout` | sess├úo | Revoga o refresh token |
| `GET` | `/auth/me` | sess├úo | Usu├írio, eleva├º├úo e assinatura |
| `POST` | `/auth/elevate` | sess├úo | `{ code }` ÔåÆ elevation token |
| `POST` | `/auth/totp/setup` | sess├úo | `{ password? }` ÔåÆ secret + QR code |
| `POST` | `/auth/totp/confirm` | sess├úo | `{ code }` ÔåÆ ativa TOTP |
| `GET/POST` | `/auth/users` | ADM | Listar / criar usu├írios |
| `PATCH` | `/auth/users/:id/subscription` | ADM | Renovar assinatura |

### Arquivos e pipeline

| M├®todo | Rota | Auth | Descri├º├úo |
|--------|------|------|-----------|
| `GET` | `/files` | sess├úo + eleva├º├úo | Lista arquivos do usu├írio em `output/<userId>/` |
| `DELETE` | `/files/:name` | sess├úo + eleva├º├úo | Remove arquivo do usu├írio |
| `GET` | `/open/:filename` | sess├úo + eleva├º├úo | Serve arquivo (aceita tokens na query: `?access_token=&elevation_token=`) |
| `POST` | `/input/stage` | sess├úo + eleva├º├úo | Upload base64 de PDF/planilha ÔåÆ `staging/<userId>/` |
| `POST` | `/input/run` | sess├úo + eleva├º├úo | Stage + processa na mesma chamada |
| `POST` | `/input/process` | sess├úo + eleva├º├úo | Processa arquivos j├í em staging |
| `POST` | `/pipeline/scan` | sess├úo + eleva├º├úo | `{ inputDir }` ÔåÆ lista PDFs |
| `POST` | `/pipeline/run` | sess├úo + eleva├º├úo | Pipeline completo (scan ÔåÆ extract ÔåÆ export) |
| `POST` | `/spreadsheet/scan` | sess├úo + eleva├º├úo | Lista planilhas em `inputDir` |
| `POST` | `/spreadsheet/import` | sess├úo + eleva├º├úo | Importa planilha ÔåÆ `.csv` + `.xlsx` |

### LLM

| M├®todo | Rota | Auth | Descri├º├úo |
|--------|------|------|-----------|
| `GET/POST` | `/llm/models` | sess├úo | Listar / criar modelos do usu├írio |
| `GET/PUT/DELETE` | `/llm/models/:id` | sess├úo | Detalhar / atualizar / remover |
| `POST` | `/llm/models/:id/health` | sess├úo | Testa conectividade com o provedor |
| `POST` | `/llm/process` | sess├úo + eleva├º├úo | Processa arquivo com LLM |
| `GET` | `/llm/jobs` | sess├úo | Hist├│rico de processamentos do usu├írio |
| `GET` | `/llm/jobs/:id` | sess├úo | Detalhe + `responseUrl` |

### Logs (ADM)

| M├®todo | Rota | Descri├º├úo |
|--------|------|-----------|
| `GET` | `/logs` | Lista logs (`?search=&sort=name\|date&order=asc\|desc`) |
| `GET` | `/logs/:filename` | Conte├║do textual |
| `DELETE` | `/logs/:filename` | Remove arquivo |
| `POST` | `/logs/batch-delete` | `{ files: ["a.log", ...] }` ÔÇö exclus├úo at├┤mica |

---

## API program├ítica

```javascript
// Facade Fase 1
const { listPdfs, extractText, extractBatch, exportCsv, exportXlsx } = require('./src/api');

// Facade Fase 2 (re-exporta Fase 1 + LLM)
const { LlmSummarizerBuilder, createLlmAdapter, createPersistenceAdapter } = require('./src/api-v2');

// Facade Fase 3 (re-exporta Fases 1+2 + planilha)
const { SpreadsheetSummarizerBuilder, importSpreadsheet } = require('./src/api-v3');
```

### Builder ÔÇö modo web completo

```javascript
const app = LlmSummarizerBuilder.create()
  .fromPhase1Api(require('./src/api'))
  .outputTo('./output')
  .withLogs('./logs')
  .withPersistence('sqlite', { dbPath: './data/app.db' })
  .withTokenEncryption({ keyEnv: 'APP_SECRET_KEY' })
  .registerLlmProviders(['ollama', 'openrouter'])
  .serve({ port: 4000, host: '127.0.0.1', staticDir: './public' })
  .build();

await app.start();
console.log(app.url); // http://127.0.0.1:4000
await app.close();
```

### Builder ÔÇö modo headless (testes / integra├º├úo)

```javascript
const app = LlmSummarizerBuilder.create()
  .fromPhase1Api(require('./src/api'))
  .withPersistence('memory')
  .withoutServer()
  .build();

await app.start();
// app.llmModelService, app.llmProcessService, app.persistence
await app.close();
```

### M├│dulos isolados

```javascript
// Listar PDFs
const pdfs = await listPdfs('./pdfs', { recursive: false });
// [{ name, path, sizeBytes }, ...]

// Extrair texto
const result = await extractText('./pdfs/doc.pdf', './output', { overwrite: true });
// { inputFile, outputFile, pageCount, charCount, text, extractedAt }

// Batch tolerante a falhas
const { results, errors } = await extractBatch(['a.pdf', 'b.pdf'], './output');

// Exportar (layout unimed-report)
const csv  = await exportCsv([result], './output');
const xlsx = await exportXlsx([result], './output');
// { filePath, rowCount, sourcePdf, format: 'unimed-report' }
```

---

## Estrutura do projeto

```
striviapp/
Ôö£ÔöÇÔöÇ src/
Ôöé   Ôö£ÔöÇÔöÇ api.js                  # Facade p├║blica ÔÇö Fase 1
Ôöé   Ôö£ÔöÇÔöÇ api-v2.js               # Facade p├║blica ÔÇö Fase 2
Ôöé   Ôö£ÔöÇÔöÇ api-v3.js               # Facade p├║blica ÔÇö Fase 3
Ôöé   Ôö£ÔöÇÔöÇ index.js                # Entry point CLI
Ôöé   Ôö£ÔöÇÔöÇ server.js               # Entry point web (npm run start:web)
Ôöé   Ôö£ÔöÇÔöÇ adapters/               # Implementa├º├Áes: PDF, Excel, CSV, crypto, JWT, LLM, DB...
Ôöé   Ôö£ÔöÇÔöÇ modules/                # Dom├¡nio: scanner, extractor, exporter, auth, logs, LLM...
Ôöé   Ôö£ÔöÇÔöÇ pipeline/               # Orquestradores fluentes (PdfSummarizerBuilder, etc.)
Ôöé   Ôö£ÔöÇÔöÇ errors/                 # Erros tipados por m├│dulo
Ôöé   ÔööÔöÇÔöÇ utils/                  # paths.js, userWorkspace.js
Ôö£ÔöÇÔöÇ public/                     # UI ÔÇö HTML + CSS + JS vanilla
Ôöé   Ôö£ÔöÇÔöÇ index.html
Ôöé   Ôö£ÔöÇÔöÇ css/app.css
Ôöé   ÔööÔöÇÔöÇ js/                     # session-store, auth-ui, api-client, logs-ui...
Ôö£ÔöÇÔöÇ tests/                      # 308 testes (42 suites)
Ôö£ÔöÇÔöÇ fixtures/                   # PDFs e planilhas de exemplo para testes
Ôö£ÔöÇÔöÇ .env.example
ÔööÔöÇÔöÇ jest.config.js
```

---

## Testes

```bash
npm test               # todas as 42 suites (308 testes)
npm run test:coverage  # com relat├│rio de cobertura ÔëÑ 80%
npm run test:watch     # modo watch
```

Cada m├│dulo tem sua suite espelhada em `tests/`: `scanner.test.js`, `authService.test.js`, `logViewerService.test.js`, `fase6MultiTenant.test.js`, `securityHardening.test.js`, etc.

---

## Scripts

| Script | Descri├º├úo |
|--------|-----------|
| `npm run start:web` | Servidor web ÔÇö UI + API REST + auth |
| `npm start` | CLI Fase 1 ÔÇö extrai PDFs e gera planilhas |
| `npm run start:spreadsheet` | CLI Fase 3 ÔÇö importa planilhas Unimed |
| `npm test` | Suite completa |
| `npm run test:coverage` | Cobertura de linha ÔëÑ 80% |
| `node scripts/create-fixtures.js` | Gera PDFs de teste em `fixtures/` |

---

## Stack

| Camada | Biblioteca |
|--------|-----------|
| Runtime | Node.js ÔëÑ 20 LTS |
| PDF parsing | `pdf-parse` |
| Excel | `exceljs` |
| CSV | `csv-writer` |
| Encoding | `iconv-lite` (latin-1 / Windows-1252) |
| Persist├¬ncia | `better-sqlite3` ┬À `mysql2` |
| Logs | `pino` (NDJSON) |
| QR Code | `qrcode` (setup TOTP ÔÇö sem servi├ºo externo) |
| JWT / TOTP / Crypto | `node:crypto` nativo ÔÇö zero depend├¬ncias extras |
| Testes | Jest 30 |

---

## Especifica├º├Áes t├®cnicas

| Fase | Arquivo |
|------|---------|
| 1 ÔÇö Pipeline PDF (TDD) | [`FASE1.spec.md`](FASE1.spec.md) |
| 2 ÔÇö UI + LLM + Persist├¬ncia | [`FASE2.spec.md`](FASE2.spec.md) |
| 3 ÔÇö Entrada de Planilhas | [`FASE3.spec.md`](FASE3.spec.md) |
| 4 ÔÇö Aba de Logs | [`FASE4.spec.md`](FASE4.spec.md) |
| 5 ÔÇö JWT + TOTP + RBAC | [`FASE5.spec.md`](FASE5.spec.md) |
| 6 ÔÇö Multi-tenant + MySQL | [`FASE6.spec.md`](FASE6.spec.md) |

Vis├úo original das fases: [`README_OLD.md`](README_OLD.md)

---

## Licen├ºa

MIT
