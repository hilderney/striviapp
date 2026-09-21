# GitHub Releases — publicação e operação de atualizações

Este guia complementa a [especificação do atualizador](specs/07-github-auto-update.spec.md).

## Modelo de distribuição

O repositório público funciona como feed de binários. Ele não precisa ser o mesmo repositório do
código-fonte e não deve receber dados operacionais do aplicativo.

```text
CI confiável
  → testa e empacota versão N+1
  → gera instalador + blockmap + latest.yml
  → publica GitHub Release

Striviapp versão N
  → consulta latest.yml
  → baixa somente blocos alterados quando possível
  → verifica SHA-512
  → instala ao encerrar
  → reabre como N+1
```

## Por que não copiar arquivos manualmente

Um atualizador que baixa ZIP e substitui arquivos em uso aumenta o risco de instalação parcial,
DLL/ASAR incompatível, execução de conteúdo adulterado e falta de rollback. O fluxo do
`electron-updater` coordena metadata, integridade, download diferencial e instalador NSIS.

O patch diferencial é uma otimização, não um formato independente que precise ser aplicado à mão.

## Estrutura de uma release

Exemplo:

```text
v2.0.1
  Striviapp-Setup-2.0.1.exe
  Striviapp-Setup-2.0.1.exe.blockmap
  latest.yml
  release notes
```

`latest.yml` contém versão, arquivo e hash esperado. Os nomes exatos dependem da configuração do
`electron-builder`; o CI deve falhar se faltar qualquer artefato obrigatório.

## Versionamento

Usar SemVer:

- patch (`2.0.0 → 2.0.1`): correção compatível;
- minor (`2.0.0 → 2.1.0`): funcionalidade compatível;
- major (`2.0.0 → 3.0.0`): mudança incompatível ou migração relevante.

Nunca reutilizar uma versão já publicada. Não substituir silenciosamente ativos de uma release:
publique nova versão para preservar rastreabilidade e hashes.

## Processo de publicação

1. Atualizar versão do produto Windows.
2. Escrever notas de release e instruções de migração.
3. Executar testes e build limpo.
4. Verificar que nenhum processo mantém `win/dist` aberto.
5. Gerar NSIS, `.blockmap` e metadata.
6. Verificar ausência de segredos e dados de clientes.
7. Assinar binários quando code signing estiver disponível.
8. Publicar primeiro como prerelease/canal de homologação.
9. Atualizar uma instalação real da versão anterior.
10. Validar banco, arquivos, login, logs e processamento.
11. Promover/publicar no canal estável.
12. Monitorar falhas e suporte.

## CI/CD

O workflow precisa:

- disparar somente por tag/versionamento autorizado;
- instalar dependências com lockfile;
- rodar testes;
- empacotar em runner Windows;
- usar token de publicação com privilégio mínimo;
- obter certificado e senha via secrets do CI, nunca do repositório;
- publicar todos os artefatos de forma consistente;
- produzir inventário de hashes;
- impedir release parcial.

Para repositório público, o aplicativo baixa anonimamente. `GH_TOKEN` serve para publicar no CI e
não deve existir no executável.

## Migração do banco

O banco fica em `%APPDATA%\striviapp-win\app-data\app.db`; logs, staging e entrada também ficam em
`userData`. Arquivos gerados ficam em `%USERPROFILE%\Documents\Striviapp`. Nada disso deve ficar em
`Program Files` nem em `resources`.

Cada versão que altera schema deve:

1. ler a versão atual do schema;
2. criar backup quando a mudança não for trivial;
3. iniciar transação;
4. executar migrações sequenciais e idempotentes;
5. atualizar a versão do schema;
6. confirmar a transação;
7. registrar resultado;
8. restaurar/bloquear escrita em caso de falha.

Não assumir que o usuário atualiza sempre da versão imediatamente anterior. O migrador deve suportar
saltos dentro da janela declarada ou exigir uma versão intermediária com mensagem clara.

## Experiência do usuário

Fluxo recomendado:

1. **Verificar atualizações**.
2. “Versão 2.0.1 disponível” com resumo.
3. **Baixar atualização**.
4. Barra de progresso sem bloquear o uso normal.
5. “Atualização pronta”.
6. **Reiniciar e atualizar**.
7. Se houver processamento, explicar que o reinício ocorrerá após concluir/cancelar.
8. Reabrir e mostrar “Atualizado para 2.0.1”.

Não fechar o aplicativo automaticamente enquanto o usuário trabalha.

## Log de atualização

Local:

```text
%APPDATA%\striviapp-win\logs\update.log
```

Exemplo de campos:

```text
timestamp
event
currentVersion
targetVersion
channel
progress
downloadMode = differential | full
result
errorCode
errorMessageSanitized
```

Rotacionar logs e limitar retenção. A interface pode oferecer “Copiar diagnóstico”, removendo paths
com nome do usuário, URLs temporárias e qualquer token.

## Falha e recuperação

### Download falhou

Manter a instalação atual, informar o erro e permitir nova tentativa. Não aplicar arquivo parcial.

### Integridade falhou

Apagar o artefato, recusar instalação e registrar alerta. Não oferecer botão para ignorar SHA-512.

### Instalação falhou

Manter dados de `%APPDATA%`, registrar erro e orientar uso da versão atual/instalador anterior. O
suporte deve ter link para a release estável conhecida.

### Migração de banco falhou

Não continuar escrevendo no schema incerto. Preservar banco e backup, registrar diagnóstico e
oferecer recuperação assistida.

### Release comprometida

1. retirar/invalidar a release;
2. bloquear o canal afetado quando possível;
3. publicar versão corrigida com número novo;
4. rotacionar tokens e credenciais de CI;
5. auditar tags, workflow e mantenedores;
6. comunicar usuários;
7. usar assinatura de código para distinguir artefatos legítimos.

## Checklist da primeira implantação

- [ ] Repositório/feed público definido.
- [ ] Owner, repo e canal fixos na configuração.
- [ ] `electron-updater` roda somente no main process.
- [ ] IPC mínimo implementado.
- [ ] Botão e estados de UI implementados.
- [ ] `autoDownload` desabilitado até consentimento.
- [ ] Reinício bloqueado durante operação crítica.
- [ ] Log e rotação implementados.
- [ ] `userData` permanece fora da instalação.
- [ ] Migração de banco transacional testada.
- [ ] Release inclui installer, blockmap e metadata.
- [ ] SHA inválido e fallback completo testados.
- [ ] Tokens de publicação existem somente no CI.
- [ ] Piloto N → N+1 concluído.

