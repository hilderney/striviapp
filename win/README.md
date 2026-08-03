# Striviapp — Windows (`win/`)

Produto desktop v2.0.0 (Electron + NSIS + licenciamento remoto).

Especificação: [`../FASE7.spec.md`](../FASE7.spec.md)

```bash
cd win
npm install
npm test                # suíte Jest (runtime Node)
npm run start:desktop   # abre a janela Electron
npm run start:web       # mesmo backend no navegador, em http://127.0.0.1:4000
npm run dev             # Electron com reload (electronmon)
npm run build           # alias de dist:win — gera Setup.exe (sem rodar testes)
npm run dist:win        # gera Setup.exe (após implementação completa)
```

Na raiz do monorepo: `npm run dev` sobe web + desktop juntos; `npm run build` roda os testes e gera o instalador.

## Módulo nativo: Node vs Electron

`better-sqlite3` é compilado para um `NODE_MODULE_VERSION` específico, e Node e
Electron usam ABIs diferentes. Um único `node_modules` não serve os dois ao mesmo
tempo, então `scripts/native-abi.js` recompila o módulo sob demanda: os scripts
`test`/`start:web` garantem o build de Node e `start:desktop`/`pack:win`/`dist:win`
garantem o build de Electron. A troca leva cerca de 20s e só acontece quando o
runtime muda; nos demais casos é instantânea.

Se algo falhar com `NODE_MODULE_VERSION`, rode `npm run abi:node` ou
`npm run abi:electron` conforme o runtime desejado. Feche o app desktop antes de
rodar os testes: o Windows bloqueia o `.node` em uso e a recompilação falha.

## Dados locais

No modo desktop nada fica na pasta do projeto:

| Conteúdo | Local |
| --- | --- |
| Banco, segredos e estado de licença | `%APPDATA%\striviapp-win\app-data\` |
| Logs, staging e input | `%APPDATA%\striviapp-win\` |
| Planilhas exportadas | `Documentos\Striviapp\` |

`APP_SECRET_KEY` e `JWT_SECRET` são gerados na primeira execução e guardados
cifrados via DPAPI (`safeStorage`), então sessões e tokens sobrevivem a reinícios
sem `.env`. O login inicial é `admin` / `admin123` (minúsculas; o lookup de
username é case-sensitive) — troque pelo botão **Trocar senha** no cabeçalho, que
usa `POST /api/v1/auth/password`, exige a senha atual e desconecta as outras sessões.

O servidor de licenças fica em [`license-server/`](license-server/) e **não** é empacotado no instalador.
