# Striviapp (monorepo)

Dois projetos independentes no mesmo repositório:

| Pasta | Produto | Versão |
|-------|---------|--------|
| [`web/`](web/) | App web local (Fases 1–6) — multi-tenant, JWT/TOTP, SQLite/MySQL | 0.1.0 |
| [`win/`](win/) | Desktop Windows (Fase 7) — Electron, instalador NSIS, licença remota | 2.0.0 |

Especificações: `FASE1.spec.md` … [`FASE7.spec.md`](FASE7.spec.md) na raiz.

## Desenvolvimento local

Na raiz do repositório:

```bash
npm run install:all   # instala web/ e win/
npm run dev           # sobe web + desktop em paralelo (com watch)
npm run build         # roda todos os testes e gera o instalador NSIS
```

### `npm run dev`

Sobe os dois produtos ao mesmo tempo, com reload automático e logs prefixados:

| Prefixo | O que sobe | Como testar |
|---------|------------|-------------|
| `[web]` | Servidor em `http://127.0.0.1:4000` (`nodemon`) | Navegador |
| `[win]` | Janela Electron (`electronmon`, ABI Electron) | App desktop |

Login inicial do desktop: `admin` / `admin123` (minúsculas).

Para rodar só um lado:

```bash
npm run dev:web
npm run dev:win
```

Ctrl+C encerra os dois processos (e a árvore de filhos no Windows).

### `npm run build`

Encadeia, nesta ordem:

1. `npm test` → suítes de `web/` e `win/` (paridade via `pretest`)
2. `npm run build:win` → `electron-builder` NSIS

**Importante:** feche o app desktop (e qualquer processo que esteja usando `win/dist/`) antes de `npm test` ou `npm run build`. No `win/`, testes usam ABI Node e o build usa ABI Electron; se o `.node` ou o `app.asar` estiver em uso, a recompilação/empacotamento falha no Windows.

### Instalador Windows (NSIS)

Artefato para distribuição:

`win/dist/Striviapp-Setup-2.0.0.exe`

| | |
|---|---|
| Formato | NSIS (wizard, não one-click) |
| Arquitetura | x64 |
| Instalação | Por usuário (`perMachine: false`); permite escolher a pasta |
| Atalhos | Desktop e Menu Iniciar |
| Desinstalação | Não apaga `%APPDATA%\striviapp-win\` (`deleteAppDataOnUninstall: false`) |

Gerar **só** o instalador (sem rodar testes):

```bash
npm run build:win
```

Ou, dentro de `win/`:

```bash
cd win
npm run dist:win   # ou: npm run build
```

O arquivo gerado é o que você distribui aos usuários finais. O servidor de licenças (`win/license-server/`) **não** entra no EXE.

**Assinatura de código:** o instalador sai sem certificado. O SmartScreen do Windows pode exibir aviso de “editor desconhecido” na primeira execução — esperado até haver code signing.

### Outros comandos da raiz

| Comando | Efeito |
|---------|--------|
| `npm run test:web` / `test:win` | Suíte de um produto |
| `npm run start:web` | Servidor web sem watch |
| `npm run start:desktop` | Electron sem watch |
| `npm run verify:parity` | Só o portão de IDs de teste |
| `npm run build:win` | Só o instalador (sem testes) |

Dentro do `win/`, `npm run build` é alias de `dist:win` e gera só o instalador. O `build` que roda as duas suítes antes de empacotar é o da raiz.

## Web (Fases 1–6)

```bash
npm run install:all
npm run test:web
npm run start:web
# ou, com watch: npm run dev:web
```

Documentação detalhada do produto web: [`web/README.md`](web/README.md).

## Windows (Fase 7)

```bash
npm run install:all
npm run test:win
npm run start:desktop
# ou, com watch: npm run dev:win
```

Para gerar o instalador NSIS (`win/dist/Striviapp-Setup-2.0.0.exe`), veja [Instalador Windows (NSIS)](#instalador-windows-nsis) acima (`npm run build:win`).

Licenças (API MySQL, não empacotada no EXE):

```bash
cd win/license-server
npm install
npm start
```

Ver [`win/README.md`](win/README.md) e [`FASE7.spec.md`](FASE7.spec.md).

## Paridade de testes

Os backends de `web/` e `win/` são cópias independentes. Para que a cobertura compartilhada não divirja silenciosamente, a raiz mantém um manifesto de IDs e um portão acoplado ao `npm test`.

### Manifesto

Arquivo: [`tests-manifest.json`](tests-manifest.json)

| Campo | Significado |
|-------|-------------|
| `cases[].id` | ID do caso (`F2-01`, `RED-19`, `F7-54`, …) |
| `cases[].file` / `files` | Onde o ID aparece (aceita várias localizações em colisões deliberadas) |
| `cases[].required` | Produtos que **obrigatoriamente** devem ter o ID (`web`, `win` ou ambos) |
| `cases[].status` | `implemented` (portão exige) ou `pending` (registrado na spec, ainda sem teste) |
| `files[]` | Arquivos de teste sem ID no nome; rastreados só pelo caminho |

O filtro é por ID, não por arquivo. Exemplo: IDs de `fase6MultiTenant.test.js` são `required: ["web"]`; o restante herdado das Fases 2–5 e a maior parte da Fase 6 é `["web","win"]`; tudo de F7 e `changePassword` é `["win"]`.

### Portão

```bash
npm run verify:parity          # os dois produtos
cd web && npm test             # pretest → verify-test-parity --product web
cd win && npm test             # pretest → verify-test-parity --product win
```

O script [`scripts/verify-test-parity.js`](scripts/verify-test-parity.js) varre os `*.test.js` estaticamente (casos `[F2-01]` e faixas em `describe` como `(F7-59..F7-62)`). Ele **falha só por ausência**: um teste a mais em um produto nunca quebra o build. IDs `pending` não são exigidos.

### Como adicionar um teste

1. Escreva o caso com ID no nome, preferencialmente `[Fx-NN] descrição`.
2. Coloque o arquivo em `web/tests/` e/ou `win/tests/` conforme o produto.
3. Registre o ID (ou o caminho, se o arquivo não usa IDs) em [`tests-manifest.json`](tests-manifest.json) com `required` e `status: "implemented"`.
4. Rode `npm run verify:parity` e em seguida `npm test` no(s) produto(s) afetado(s).

### Fixtures versionadas

O `.gitignore` bloqueia `fixtures/` em geral (PDFs reais de cliente), mas libera os arquivos sintéticos usados pelos testes:

- `web/fixtures/unimed-demonstrativo.tsv` e `win/fixtures/unimed-demonstrativo.tsv`
- `web/tests/fixtures/` e `win/tests/fixtures/`

Sem esses arquivos, 9 testes de planilha/export falham em clone limpo.

## Compozy

Este repositório usa o Compozy CLI estável para orquestrar a implementação da Fase 7:

```bash
npm install -g @compozy/cli
compozy setup -a cursor -y
```
