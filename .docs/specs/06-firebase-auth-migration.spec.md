# Especificação — Migração de autenticação para Firebase

Status: planejado  
Produtos: `win/` e, quando aplicável, `web/`  
Dependências: Firebase Authentication, serviço remoto confiável e Firestore ou banco equivalente

## 1. Objetivo

Migrar a identidade do Striviapp do cadastro local com senha e JWT próprio para Firebase
Authentication. O Firebase gerencia contas, credenciais, hash de senha e sessão. O aplicativo
continua processando arquivos localmente, mas só libera funções protegidas após validar a identidade,
o papel e a licença do usuário.

Fluxo-alvo:

```text
Electron (login)
  → Firebase Authentication
  → Firebase ID Token
  → API local do Striviapp, via Authorization: Bearer <idToken>
  → validação de assinatura, emissor, audiência, expiração e claims
  → consulta de licença/assinatura no serviço remoto confiável
  → autorização das rotas locais
```

## 2. Escopo

### 2.1 No Firebase

- Contas e e-mails.
- Senhas e respectivos hashes, administrados pelo Firebase Authentication.
- Identificador estável `uid`.
- Custom Claim mínima para papel: `role = ADM | USER`.
- Estado de acesso, licença e assinatura em documento protegido ou backend equivalente.
- Expiração, plano e status de assinatura.

### 2.2 Local

- Arquivos recebidos e processados.
- Planilhas, PDFs e demais artefatos gerados.
- Logs.
- Banco operacional e cache não sensível.
- Vínculo entre o `uid` e o workspace local do usuário.

### 2.3 Fora do escopo inicial

- Sincronização de documentos de clientes com a nuvem.
- Execução remota do processamento de planilhas/PDFs.
- Armazenamento de Service Account no desktop.
- Permissão para o cliente alterar papel, licença, plano ou validade.
- Migração direta dos hashes de senha locais para Firestore.

## 3. Princípios de segurança

1. O Electron é um cliente não confiável. Qualquer segredo empacotado no `.exe` pode ser extraído.
2. Nenhuma Service Account, chave privada ou credencial do Firebase Admin entra no aplicativo.
3. O Firebase JavaScript SDK usa apenas a configuração pública do projeto.
4. Operações administrativas usam Firebase Admin SDK exclusivamente em backend confiável.
5. O backend valida o ID Token e sua revogação antes de executar operações protegidas.
6. A API local valida o token e não aceita `uid`, `role` ou licença enviados como campos livres.
7. Custom Claims carregam somente autorização pequena e estável; dados de licença permanecem no
   banco remoto.
8. Firestore Security Rules negam ao usuário escrita sobre campos administrativos.
9. Tokens e respostas de licença usam vida curta; logout, desativação ou revogação invalidam acesso.
10. Logs não registram senha, ID Token completo, refresh token, segredo TOTP ou credenciais privadas.

## 4. Requisitos funcionais

| ID | Requisito |
|---|---|
| FB-AUTH-01 | O usuário entra com e-mail e senha por Firebase Authentication. |
| FB-AUTH-02 | O Firebase SDK obtém e renova o ID Token sem expor senha à API local. |
| FB-AUTH-03 | Toda chamada protegida envia `Authorization: Bearer <idToken>`. |
| FB-AUTH-04 | A API local rejeita token ausente, inválido, expirado, com emissor/audiência incorretos ou usuário desabilitado. |
| FB-AUTH-05 | O `uid` validado torna-se o identificador do workspace local. |
| FB-AUTH-06 | Somente `role` validado como `ADM` acessa funções administrativas. |
| FB-AUTH-07 | Usuários `USER` precisam de licença/assinatura ativa para processar e acessar arquivos. |
| FB-AUTH-08 | Usuário `ADM` segue a política comercial definida para isenção ou licença administrativa. |
| FB-AUTH-09 | O aplicativo oferece logout e limpa o estado de autenticação local. |
| FB-AUTH-10 | Redefinição de senha usa o fluxo seguro do Firebase. |
| FB-AUTH-11 | Usuário desativado ou com tokens revogados perde acesso após a janela máxima definida. |
| FB-AUTH-12 | Falha de rede segue política offline explícita e nunca promove privilégios. |
| FB-AUTH-13 | Arquivos e resultados permanecem na máquina do usuário. |
| FB-AUTH-14 | A interface mostra mensagens claras para credencial inválida, conta desativada, licença expirada e indisponibilidade remota. |

## 5. Componentes

### 5.1 Cliente Firebase no Electron

Responsabilidades:

- inicializar Firebase com configuração pública por ambiente;
- executar login por e-mail/senha;
- observar mudanças de autenticação;
- obter ID Token atual, permitindo renovação automática;
- executar recuperação de senha e logout;
- fornecer o ID Token ao cliente HTTP local.

O cliente não lê nem escreve diretamente campos administrativos de usuário.

### 5.2 Verificador de identidade da API local

Substitui a dependência direta do JWT simétrico atual no `authGuard`.

Contrato proposto:

```js
class IdentityVerifier {
  async verifyIdToken(idToken, options = { checkRevoked: true }) {
    // retorna identidade normalizada ou lança AuthError
  }
}

// resultado normalizado
{
  userId: 'firebase-uid',
  email: 'usuario@example.com',
  role: 'ADM' | 'USER',
  issuedAt: 'ISO-8601',
  expiresAt: 'ISO-8601'
}
```

Validações obrigatórias:

- assinatura contra chaves públicas oficiais;
- `alg` permitido;
- `iss` igual ao projeto esperado;
- `aud` igual ao Firebase Project ID esperado;
- `sub`/`uid` não vazio;
- `iat`, `auth_time` e `exp`;
- revogação quando exigida;
- claim `role` pertencente ao conjunto permitido.

### 5.3 Serviço remoto de identidade e licenciamento

Executado fora do Electron, em Cloud Functions/Cloud Run ou API própria.

Responsabilidades:

- validar Firebase ID Token com Firebase Admin SDK;
- verificar revogação e usuário desabilitado;
- consultar licença e assinatura;
- criar/desativar usuários por fluxo administrativo;
- definir/remover Custom Claims;
- renovar/cancelar assinatura;
- registrar auditoria;
- emitir resposta de entitlement curta e assinada quando necessária para a API local.

Endpoints conceituais:

```text
GET   /v1/session/entitlement
POST  /v1/admin/users
PATCH /v1/admin/users/:uid/access
PATCH /v1/admin/users/:uid/subscription
POST  /v1/admin/users/:uid/revoke
```

O contrato HTTP definitivo deve usar idempotência nas mutações administrativas e códigos de erro
estáveis.

### 5.4 Repositório remoto de perfis

Modelo mínimo sugerido:

```text
users/{uid}
  email: string
  role: "ADM" | "USER"
  accessStatus: "active" | "disabled"
  subscription:
    status: "active" | "expired" | "cancelled" | "none"
    plan: string | null
    expiresAt: timestamp | null
  createdAt: timestamp
  updatedAt: timestamp
```

`role`, `accessStatus` e `subscription` são campos administrados pelo servidor. O e-mail canônico
vem do Firebase Authentication.

### 5.5 Cache local de entitlement

O cache, se habilitado, contém somente uma resposta assinada de curta duração. Não substitui a fonte
remota e não permite prolongar licença após expiração. O comportamento offline precisa ser definido
antes da implementação:

- política estrita: negar operações protegidas sem validação remota; ou
- tolerância limitada: aceitar entitlement assinado ainda não expirado por período curto.

## 6. Integração com a arquitetura atual

| Área atual | Mudança planejada |
|---|---|
| `public/js/auth-ui.js` | Login passa de usuário/senha local para e-mail/senha Firebase. |
| `public/js/api-client.js` | `Authorization` passa a carregar Firebase ID Token atualizado. |
| `modules/authGuard.js` | Usa identidade Firebase normalizada e entitlement remoto. |
| `modules/authService.js` | Deixa de emitir access/refresh token próprio; responsabilidades restantes são separadas. |
| `adapters/jwtAdapter.js` | Mantido apenas enquanto necessário para rollback/entitlement assinado; removido do login final. |
| persistência de usuários | Senha/hash e refresh tokens locais deixam de ser fonte de identidade. |
| `utils/userWorkspace.js` | Usa `uid` sanitizado como chave estável de isolamento. |
| TOTP local | Substituído ou redesenhado conforme a decisão de MFA. |

## 7. Regras do Firestore

Requisitos mínimos:

- negar escrita direta de clientes em `role`, `accessStatus`, `subscription`, `createdAt` e
  `updatedAt`;
- negar leitura de perfil de outro usuário;
- permitir somente os campos pessoais explicitamente aprovados, se houver;
- tratar toda escrita administrativa via backend com Admin SDK;
- manter testes automatizados de regras no Firebase Emulator Suite.

Exemplo conceitual, não pronto para produção:

```text
match /users/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

## 8. Migração

### Fase 1 — convivência

- adicionar `IdentityVerifier` sem remover o login legado;
- habilitar Firebase por feature flag e ambiente;
- criar vínculo `legacyUserId → firebaseUid`;
- manter rollback possível.

### Fase 2 — migração das contas

- exportar somente identidade administrativa necessária, sem hashes para o cliente;
- criar contas Firebase por processo seguro;
- enviar recuperação/redefinição de senha;
- migrar papel, plano, status e validade por backend;
- validar o workspace local associado ao `uid`.

### Fase 3 — corte

- bloquear novos logins locais;
- revogar refresh tokens próprios;
- remover bootstrap `admin/admin123`;
- remover hashes locais após backup, aceite e prazo de rollback;
- desativar endpoints legados de criação/troca de senha.

## 9. Tratamento de erros

| Situação | Resultado |
|---|---|
| Token ausente | `401 AUTH_REQUIRED` |
| Token inválido/expirado | `401 TOKEN_INVALID`; cliente força renovação uma vez |
| Token revogado/usuário desabilitado | `401 SESSION_REVOKED`; logout local |
| Claim de papel inválida | `403 FORBIDDEN_ROLE` e auditoria |
| Licença inativa | `403 SUBSCRIPTION_EXPIRED` |
| Serviço remoto indisponível | regra offline definida, sem elevação de privilégio |
| Relógio local divergente | mensagem orientando sincronização, sem ignorar validade |

## 10. Testes obrigatórios

### Unidade

- validação de emissor, audiência, assinatura, expiração, `uid` e papel;
- mapeamento de erros Firebase para erros da API;
- decisão de licença ativa/expirada;
- sanitização de `uid` para workspace;
- expiração e assinatura do cache de entitlement.

### Integração

- login Firebase → ID Token → API local;
- renovação automática após expiração;
- revogação/desativação bloqueando nova chamada;
- Custom Claim `ADM`/`USER`;
- consulta de licença;
- regras Firestore negando alteração administrativa pelo cliente.

### Ponta a ponta

- usuário ativo processa e acessa seus arquivos;
- usuário expirado entra, mas não executa operação protegida;
- administrador executa funções permitidas;
- um usuário não acessa workspace de outro;
- logout elimina a sessão;
- pacote Electron não contém Service Account ou chave privada.

## 11. Critérios de aceite

- [ ] Nenhuma senha ou hash de senha é persistido pelo Striviapp.
- [ ] Nenhuma credencial Firebase Admin existe no pacote Electron.
- [ ] O login usa Firebase Authentication e ID Token renovável.
- [ ] A API local valida identidade e autorização antes das rotas protegidas.
- [ ] Papéis só podem ser alterados pelo backend confiável.
- [ ] Licença/assinatura só pode ser alterada pelo backend confiável.
- [ ] `uid` preserva isolamento de arquivos e logs locais.
- [ ] Revogação e desativação encerram o acesso dentro da janela definida.
- [ ] Regras Firestore possuem testes de negação.
- [ ] Migração possui piloto, auditoria e rollback.
- [ ] O bootstrap `admin/admin123` não existe na versão publicada.

## 12. Pendências de decisão

1. Backend confiável: Cloud Functions, Cloud Run ou servidor próprio.
2. Política offline: bloqueio imediato ou tolerância curta assinada.
3. MFA: Firebase MFA ou segundo fator remoto próprio.
4. Migração de username para e-mail.
5. Administração: painel web separado ou endpoints operados internamente.
6. Frequência máxima de revalidação de licença e revogação.

