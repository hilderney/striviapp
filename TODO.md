# TODO — Próximos passos

Este arquivo registra trabalho futuro. Nenhum item abaixo está implementado enquanto não estiver
marcado como concluído e coberto por testes.

## Migração do login para Firebase

Documentos de referência:

- [Especificação funcional e técnica](.docs/specs/06-firebase-auth-migration.spec.md)
- [Arquitetura e operação](.docs/firebase-auth-architecture.md)

### 1. Preparação e decisões

- [ ] Criar projetos Firebase separados para desenvolvimento, homologação e produção.
- [ ] Ativar Firebase Authentication com provedor e-mail/senha.
- [ ] Definir domínios, política de senha, recuperação de conta e proteção contra abuso.
- [ ] Definir API remota confiável para administrar usuários, papéis, licenças e assinaturas.
- [ ] Definir política de disponibilidade: acesso negado ou janela de tolerância quando estiver offline.
- [ ] Definir migração das contas locais existentes para e-mail, incluindo troca obrigatória de senha.
- [ ] Definir política de MFA/TOTP: Firebase MFA ou serviço remoto próprio; remover o bypass
  `DISABLE_TOTP=1` antes da publicação.

### 2. Backend confiável

- [ ] Criar serviço de identidade/licenciamento fora do Electron, usando Firebase Admin SDK somente
  no servidor.
- [ ] Guardar credenciais administrativas em secret manager ou variáveis protegidas do ambiente.
- [ ] Implementar validação do Firebase ID Token com verificação de revogação.
- [ ] Implementar endpoints administrativos para criar/desativar usuários, atribuir `ADM`/`USER`,
  alterar plano e renovar/cancelar assinatura.
- [ ] Implementar Custom Claims mínimas (`role`) e atualização controlada pelo backend.
- [ ] Manter licença/assinatura em documento protegido no Firestore ou banco do serviço.
- [ ] Criar regras que impeçam o cliente de gravar `role`, licença, plano, status e validade.
- [ ] Registrar auditoria de alterações administrativas e revogações.

### 3. Aplicativo Electron

- [ ] Adicionar Firebase JavaScript SDK somente ao processo de interface autorizado.
- [ ] Configurar login por e-mail/senha e recuperação de senha.
- [ ] Obter o Firebase ID Token com renovação automática pelo SDK.
- [ ] Enviar `Authorization: Bearer <idToken>` para a API local do Striviapp.
- [ ] Não empacotar Service Account, chave privada ou credencial do Firebase Admin no `.exe`.
- [ ] Armazenar apenas sessão/cache estritamente necessário, usando proteção do sistema operacional.
- [ ] Tratar token expirado, revogado, usuário desabilitado, rede indisponível e relógio incorreto.
- [ ] Exibir estado de licença e mensagens de bloqueio sem revelar detalhes sensíveis.
- [ ] Implementar logout que encerre a sessão Firebase e limpe o estado local.

### 4. API local e autorização

- [ ] Substituir o JWT próprio em `authGuard` pela identidade Firebase validada.
- [ ] Mapear `uid` para `userId` e manter o isolamento de workspace por usuário.
- [ ] Validar assinatura, `iss`, `aud`, `sub`, `exp`, `iat` e revogação do ID Token.
- [ ] Autorizar rotas por claims validadas, nunca por dados enviados livremente pelo cliente.
- [ ] Consultar a API remota para licença/assinatura e usar resposta assinada de curta duração.
- [ ] Manter arquivos processados, planilhas, logs e cache operacional exclusivamente locais.
- [ ] Remover emissão e rotação dos access/refresh tokens próprios somente após a transição.
- [ ] Preservar temporariamente um adaptador de autenticação legado para rollback controlado.

### 5. Migração de dados

- [ ] Inventariar usuários, papéis, TOTP e assinaturas no SQLite/MySQL atual.
- [ ] Não migrar hashes `scrypt` locais para o cliente nem para o Firestore.
- [ ] Criar usuários no Firebase e usar recuperação/redefinição segura de senha.
- [ ] Migrar papéis e licenças por processo administrativo autenticado.
- [ ] Criar vínculo auditável entre ID local legado e Firebase `uid`.
- [ ] Validar que diretórios locais existentes continuam associados ao usuário correto.
- [ ] Definir data de corte, janela de rollback e descarte seguro dos hashes locais.

### 6. Testes e publicação

- [ ] Testar login, renovação, logout, revogação, usuário desabilitado e senha redefinida.
- [ ] Testar `ADM` e `USER`, assinatura ativa/expirada e tentativa de alterar claims localmente.
- [ ] Testar isolamento dos workspaces após migração para `uid`.
- [ ] Testar ausência de Service Account e chaves privadas no pacote Electron.
- [ ] Testar comportamento offline conforme a política definida.
- [ ] Testar regras do Firestore com emuladores e casos de negação.
- [ ] Executar migração piloto em ambiente de homologação.
- [ ] Publicar com monitoramento, auditoria, rollback e plano de suporte.

## Atualização automática por GitHub Releases

Documentos de referência:

- [Especificação do atualizador](.docs/specs/07-github-auto-update.spec.md)
- [Publicação e operação de atualizações](.docs/github-update-operations.md)

### 1. Preparação

- [ ] Definir repositório público exclusivo para artefatos de atualização, sem código ou segredos.
- [ ] Adicionar `electron-updater` e `electron-log` ao produto Windows.
- [ ] Configurar `electron-builder` com provider GitHub, owner, repository e canal estável.
- [ ] Manter versões SemVer crescentes no `win/package.json`.
- [ ] Confirmar que banco/logs permanecem em `%APPDATA%\striviapp-win\` e arquivos gerados em
  `%USERPROFILE%\Documents\Striviapp`, todos fora da instalação.
- [ ] Definir política de atualização obrigatória, recomendada e adiada.

### 2. Interface

- [ ] Adicionar botão **Verificar atualizações** na interface.
- [ ] Mostrar versão instalada, versão disponível e notas da versão.
- [ ] Mostrar estados: verificando, disponível, baixando, pronto, atualizado e erro.
- [ ] Exibir progresso percentual e tamanho transferido.
- [ ] Após o download, oferecer **Reiniciar e atualizar**.
- [ ] Permitir adiar quando a atualização não for obrigatória.
- [ ] Impedir reinício durante processamento de arquivos e avisar sobre trabalho em andamento.

### 3. Download e aplicação

- [ ] Consultar metadados publicados pelo `electron-builder` no GitHub Releases.
- [ ] Baixar atualização diferencial por blockmap quando disponível.
- [ ] Usar download completo como fallback automático.
- [ ] Validar versão, hash SHA-512 e metadados antes de aplicar.
- [ ] Instalar somente após o aplicativo encerrar.
- [ ] Reiniciar o aplicativo após instalação confirmada.
- [ ] Preservar banco SQLite, segredos DPAPI, logs, staging e arquivos exportados.
- [ ] Tratar atualização interrompida sem corromper a instalação atual.

### 4. Segurança

- [ ] Nunca publicar `.env`, banco, Service Account, certificados privados ou tokens no repositório.
- [ ] Restringir publicação de releases ao CI e mantenedores autorizados.
- [ ] Fixar owner/repository/canal esperados no build.
- [ ] Verificar integridade dos artefatos; não executar ZIP arbitrário baixado.
- [ ] Planejar code signing para produção; hash não substitui autenticidade do editor.
- [ ] Documentar resposta a release comprometida e rotação do canal.

### 5. Logs e suporte

- [ ] Criar log dedicado em `%APPDATA%\striviapp-win\logs\update.log`.
- [ ] Registrar versão atual/alvo, início, progresso, resultado e erro sanitizado.
- [ ] Não registrar token GitHub, URL assinada completa, credenciais ou dados de usuário.
- [ ] Exibir ação para abrir/copiar diagnóstico de atualização.
- [ ] Manter histórico limitado por tamanho e rotação.

### 6. Publicação e testes

- [ ] Criar workflow de CI para testar, empacotar e publicar GitHub Release.
- [ ] Publicar `latest.yml`, instalador NSIS e `.blockmap` esperados pelo atualizador.
- [ ] Testar 2.0.0 → 2.0.1, salto de versões, versão atual e downgrade recusado.
- [ ] Testar rede offline, download interrompido, hash inválido e release incompleta.
- [ ] Testar banco local antes/depois e migração de schema.
- [ ] Testar atualização com aplicativo processando arquivos.
- [ ] Testar fallback do diferencial para pacote completo.
- [ ] Fazer rollout piloto antes do canal estável.

