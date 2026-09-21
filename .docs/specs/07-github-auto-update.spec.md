# Especificação — Atualização automática por GitHub Releases

Status: planejado  
Produto: `win/` (Electron/Windows)  
Dependências propostas: `electron-updater`, `electron-log`, `electron-builder`, GitHub Releases

## 1. Objetivo

Adicionar ao Striviapp um botão para verificar, baixar e aplicar atualizações publicadas em um
repositório público do GitHub. O fluxo deve preferir download diferencial e concluir a instalação
ao reiniciar o aplicativo, preservando banco, logs e arquivos locais.

```text
Usuário clica "Verificar atualizações"
  → Electron consulta GitHub Releases
  → compara versão/canal
  → baixa blocos alterados ou pacote completo como fallback
  → valida metadados e SHA-512
  → usuário clica "Reiniciar e atualizar"
  → aplicativo encerra
  → atualizador instala
  → Striviapp reabre com os mesmos dados locais
```

## 2. Decisão técnica

Usar o protocolo de atualização do `electron-builder` com GitHub Releases, não um extrator ZIP
customizado. A publicação inclui `latest.yml`, instalador NSIS e `.blockmap`. O
`electron-updater` usa esses metadados para selecionar a versão, verificar SHA-512, tentar download
diferencial e instalar no encerramento.

O chamado "patch" é o download diferencial calculado pelos blockmaps. Se ele não puder ser usado, o
aplicativo baixa o instalador completo. O usuário não precisa desinstalar nem reinstalar manualmente.

## 3. Persistência local

Atualizações substituem somente arquivos instalados do aplicativo. Dados mutáveis devem permanecer
fora da pasta de instalação, sob `app.getPath('userData')`, atualmente esperado como:

```text
%APPDATA%\striviapp-win\
  app-data\app.db
  app-data\secrets.bin
  app-data\license-state.bin
  logs\
  staging\
  input\

%USERPROFILE%\Documents\Striviapp\
  arquivos gerados
```

Requisitos:

- o atualizador não remove nem sobrescreve `userData`;
- migrações de banco são versionadas, transacionais e compatíveis com rollback definido;
- antes de migração destrutiva, criar backup local controlado;
- falha de migração bloqueia o uso da nova versão e registra diagnóstico;
- desinstalação continua sem apagar dados, conforme a configuração do NSIS.

## 4. Requisitos funcionais

| ID | Requisito |
|---|---|
| UPD-01 | A interface oferece o botão **Verificar atualizações**. |
| UPD-02 | A verificação também pode ocorrer silenciosamente após a inicialização, sem interromper o usuário. |
| UPD-03 | O aplicativo exibe versão instalada, versão disponível e notas sanitizadas. |
| UPD-04 | O download só inicia após confirmação do usuário, salvo política futura explícita. |
| UPD-05 | A interface exibe progresso, bytes transferidos e estado atual. |
| UPD-06 | Quando pronto, o aplicativo oferece **Reiniciar e atualizar**. |
| UPD-07 | A atualização não encerra o app enquanto houver processamento ou gravação crítica. |
| UPD-08 | Atualização não obrigatória pode ser adiada. |
| UPD-09 | O diferencial é preferido e o pacote completo é fallback automático. |
| UPD-10 | Banco, configurações, logs, arquivos processados e gerados são preservados. |
| UPD-11 | Falhas exibem mensagem acionável e mantêm a versão atual utilizável. |
| UPD-12 | Cada tentativa gera log local sanitizado. |
| UPD-13 | Downgrade é negado por padrão. |
| UPD-14 | O atualizador funciona somente em build empacotado; desenvolvimento usa implementação simulada. |

## 5. Estados da interface

```text
idle
checking
up-to-date
available
downloading
downloaded
installing
deferred
error
```

Comportamento do botão:

| Estado | Rótulo/ação |
|---|---|
| `idle`, `up-to-date`, `error` | Verificar atualizações |
| `checking` | Verificando… (desabilitado) |
| `available` | Baixar atualização |
| `downloading` | Baixando N%… (desabilitado) |
| `downloaded` | Reiniciar e atualizar |
| `installing` | Atualizando… (desabilitado) |

## 6. Componentes

### 6.1 `updateService` no processo principal

Único componente autorizado a usar `electron-updater`.

Responsabilidades:

- configurar logger e canal;
- verificar disponibilidade;
- iniciar download;
- publicar progresso;
- validar que não há operação crítica ativa;
- chamar `quitAndInstall`;
- normalizar erros sem expor dados sensíveis.

Interface conceitual:

```js
class UpdateService {
  async check();
  async download();
  async installOnRestart();
  getState();
  onStateChanged(listener);
}
```

Configuração esperada:

```js
autoUpdater.autoDownload = false;
autoUpdater.autoInstallEvent = 'manual';
```

Se a versão utilizada do `electron-updater` ainda não expuser `autoInstallEvent`, usar a opção
equivalente suportada e fixar a versão da dependência.

### 6.2 Ponte IPC

O renderer não recebe acesso ao Node.js nem ao objeto `autoUpdater`.

Canais conceituais:

```text
updates:get-state
updates:check
updates:download
updates:install
updates:state-changed
```

Todos os payloads passam por validação e lista explícita no preload.

### 6.3 UI

A UI mostra:

- versão atual;
- versão disponível;
- notas da release como texto sanitizado;
- progresso;
- resultado/erro;
- botões de baixar, adiar e reiniciar.

## 7. Publicação

Configuração conceitual no `electron-builder`:

```json
{
  "publish": [
    {
      "provider": "github",
      "owner": "ORGANIZACAO",
      "repo": "REPOSITORIO-DE-UPDATES",
      "releaseType": "release"
    }
  ]
}
```

Cada release estável precisa conter:

- `latest.yml`;
- instalador NSIS versionado;
- `.blockmap`;
- notas da versão;
- hashes gerados pela ferramenta.

O repositório pode ser público. Configuração pública do feed não é segredo. Tokens de publicação
existem somente no CI; o aplicativo não precisa de token para baixar releases públicas.

## 8. Segurança

### 8.1 Integridade e autenticidade

- aceitar somente metadados do owner/repositório/canal compilados no app;
- exigir HTTPS;
- validar SHA-512 informado pelo metadata;
- recusar versão inferior ou metadata inconsistente;
- nunca executar artefato apontado diretamente pela UI ou por parâmetro externo;
- restringir GitHub Actions e criação de release;
- proteger branches/tags e exigir revisão.

SHA-512 detecta corrupção ou divergência do metadata, mas não substitui code signing quando o canal
de publicação for comprometido. Para produção, assinar executável e instalador com certificado de
code signing e manter a chave fora do repositório.

### 8.2 Conteúdo público

O repositório de updates não pode conter:

- `.env`;
- bancos e logs reais;
- Service Account Firebase;
- chaves privadas/certificados;
- tokens GitHub;
- dados de clientes;
- backups de `%APPDATA%`.

### 8.3 Electron

- atualizador somente no main process;
- `contextIsolation: true`;
- `nodeIntegration: false`;
- preload com API mínima;
- notas de versão renderizadas sem HTML não confiável;
- Content Security Policy preservada.

## 9. Logging

Arquivo recomendado:

```text
%APPDATA%\striviapp-win\logs\update.log
```

Eventos:

- versão atual e canal;
- início/fim de verificação;
- versão disponível;
- início e progresso resumido do download;
- diferencial usado ou fallback completo;
- validação concluída;
- pedido de reinício;
- resultado conhecido da instalação;
- código e mensagem sanitizada de erro.

Aplicar rotação por tamanho/quantidade. Não registrar URLs temporárias completas, headers, tokens,
conteúdo de arquivos ou dados pessoais.

## 10. Concorrência e reinício

Antes de instalar:

1. impedir novos processamentos;
2. aguardar ou solicitar cancelamento dos processamentos em curso;
3. concluir gravações de banco e arquivos;
4. fechar conexões SQLite e flush de logs;
5. marcar tentativa de atualização;
6. executar `quitAndInstall`.

Na inicialização seguinte:

1. detectar mudança de versão;
2. executar migrações de banco;
3. registrar sucesso;
4. liberar a interface;
5. oferecer acesso ao log se houver falha recuperável.

## 11. Erros

| Caso | Comportamento |
|---|---|
| Sem internet/GitHub indisponível | manter versão atual e permitir tentar novamente |
| Nenhuma atualização | informar que o app está atualizado |
| Download interrompido | descartar parcial inválido ou retomar conforme suporte da biblioteca |
| SHA-512 inválido | recusar instalação, apagar artefato e registrar alerta |
| Release sem metadata/blockmap | não instalar; corrigir release |
| Diferencial indisponível | baixar pacote completo |
| Processamento ativo | adiar reinício |
| Migração de banco falha | preservar backup, bloquear escrita e orientar suporte |

## 12. Testes obrigatórios

### Unidade

- máquina de estados;
- comparação SemVer e recusa de downgrade;
- normalização/sanitização de erros;
- bloqueio por operação crítica;
- mapeamento dos eventos do updater;
- rotação de log.

### Integração

- IPC permitido e payload inválido;
- feed simulado com update e sem update;
- progresso de download;
- SHA inválido;
- diferencial com fallback completo;
- `quitAndInstall` chamado somente no estado `downloaded`.

### Ponta a ponta em builds empacotados

- atualizar versão N para N+1;
- preservar `app.db`, logs, arquivos e preferências;
- aplicar migração de schema;
- interromper rede e repetir;
- adiar e instalar mais tarde;
- bloquear reinício durante processamento;
- atualizar sem privilégios administrativos extras para instalação por usuário.

## 13. Critérios de aceite

- [ ] Botão verifica e informa atualização disponível.
- [ ] Download exibe progresso e valida integridade.
- [ ] Aplicação ocorre ao reiniciar, sem reinstalação manual.
- [ ] Download diferencial funciona quando os blockmaps permitem.
- [ ] Fallback completo funciona.
- [ ] Banco e dados locais permanecem intactos.
- [ ] Tentativas e erros aparecem no log local sanitizado.
- [ ] O pacote não contém token GitHub nem segredo de publicação.
- [ ] Release adulterada/inconsistente é recusada.
- [ ] Processamento em andamento impede reinício acidental.
- [ ] Fluxo foi validado entre duas versões reais assinadas antes de produção.

