# Firebase Auth — arquitetura e operação

Este guia complementa a [especificação da migração](specs/06-firebase-auth-migration.spec.md).

## Arquitetura recomendada

```text
┌──────────────────────── Electron ────────────────────────┐
│ Firebase JS SDK                                          │
│ login → ID Token → HTTP Authorization: Bearer <token>    │
│                                                         │
│ API local (127.0.0.1)                                   │
│ valida identidade → aplica papel/licença → acessa dados  │
│                                                         │
│ app.db, logs, staging, input, output                     │
└─────────────────────────────────────────────────────────┘
                 │ HTTPS + Firebase ID Token
                 ▼
┌──────────── Backend confiável ────────────┐
│ Firebase Admin SDK                       │
│ valida token/revogação                   │
│ administra claims e licenças             │
│ audita alterações                        │
└──────────────────────────────────────────┘
                 │
        ┌────────┴─────────┐
        ▼                  ▼
Firebase Authentication   Firestore/banco
conta, senha, uid          perfil e licença
```

## Fronteiras de confiança

| Componente | Confiança | Pode conter |
|---|---|---|
| Electron/renderer | baixa | configuração pública Firebase e ID Token atual |
| API local | média, sob controle do usuário | chaves públicas em cache, identidade validada e dados locais |
| Backend remoto | alta | Firebase Admin SDK e operações administrativas |
| Firebase Auth | fonte de identidade | conta, hash de senha, sessão e revogação |
| Firestore/banco remoto | fonte de entitlement | papel, status, plano e validade |

O desktop nunca é autoridade para promover usuário ou renovar licença. Modificar JavaScript, banco
local ou resposta de UI não deve conceder acesso porque a decisão usa token e entitlement validados.

## Responsabilidade dos dados

### Nuvem

- e-mail e conta;
- hash e política de senha;
- `uid`;
- `role` em Custom Claims;
- status de acesso;
- licença, plano e expiração;
- trilha de auditoria administrativa.

### Máquina do usuário

- documentos importados;
- artefatos gerados;
- logs;
- SQLite operacional;
- cache temporário;
- preferências não sensíveis.

Não enviar documentos de cliente ao Firebase como consequência da migração de login.

## Fluxo de sessão

1. O usuário informa e-mail e senha ao Firebase SDK.
2. O Firebase retorna sessão e ID Token.
3. O cliente solicita um ID Token atual antes da chamada protegida.
4. A API local extrai exclusivamente o Bearer token.
5. O verificador valida assinatura, projeto, emissor, tempo, `uid` e claims.
6. A API local consulta/valida entitlement remoto.
7. O `authGuard` monta `request.auth` com identidade normalizada.
8. A rota autoriza por papel e licença.
9. Em `401`, o cliente tenta renovar o token uma vez; revogação força novo login.

## Administração

Somente o backend confiável:

- cria ou desativa contas;
- chama `setCustomUserClaims`;
- renova, cancela ou expira licença;
- revoga refresh tokens;
- escreve os campos protegidos do perfil;
- registra quem alterou, quando e por quê.

Alterar claims não atualiza um ID Token já emitido imediatamente. Após uma mudança administrativa,
forçar renovação do token ou aguardar sua expiração. Para bloqueios urgentes, revogar sessões e
consultar revogação no backend.

## Proteção de credenciais

- Não usar Service Account JSON no repositório, instalador ou `%APPDATA%`.
- Backend hospedado usa credenciais do ambiente/secret manager.
- A configuração web Firebase (`apiKey`, `authDomain`, `projectId`) identifica o projeto, mas não
  concede privilégios administrativos; ainda assim deve ser restrita ao projeto correto.
- Não persistir senha.
- Evitar persistir ID Token manualmente; deixar o Firebase SDK gerenciar a sessão.
- Se existir cache de entitlement, exigir assinatura, audiência, expiração curta e proteção contra
  replay conforme o risco.

## Disponibilidade e modo offline

A escolha precisa ser feita antes da implementação:

- **Estrito:** toda abertura de sessão requer validação remota. Mais seguro, menos disponível.
- **Tolerância curta:** aceitar entitlement previamente assinado e ainda válido. Melhor experiência,
  mas aumenta a janela para uma revogação surtir efeito.

Em ambos os modos:

- token/entitlement expirado nunca é aceito;
- cache não pode ser editável para estender validade;
- ausência de rede nunca transforma `USER` em `ADM`;
- operações já locais podem ter política separada, desde que documentada.

## Migração operacional

1. Criar ambientes Firebase separados.
2. Implementar backend e regras antes do cliente.
3. Adicionar adaptador `IdentityVerifier`.
4. Habilitar login Firebase por feature flag.
5. Vincular usuários legados a `uid`.
6. Migrar licenças e papéis pelo backend.
7. Pedir redefinição de senha; não reaproveitar hash local.
8. Pilotar com contas internas.
9. Revogar sessões legadas no corte.
10. Remover bootstrap e senha padrão.
11. Após a janela de rollback, apagar hashes e refresh tokens locais com procedimento auditado.

## Monitoramento

Métricas recomendadas:

- logins bem-sucedidos/falhos, sem e-mail em claro;
- tokens inválidos, expirados e revogados;
- latência/erro da consulta de entitlement;
- bloqueios por licença;
- alterações administrativas;
- divergências entre Custom Claim e perfil remoto.

Alertas:

- aumento de falhas de validação;
- indisponibilidade do backend;
- muitas tentativas na mesma conta/endereço;
- alteração em massa de papéis/licenças;
- regras Firestore ou configuração de Auth publicadas sem revisão.

## Checklist de produção

- [ ] Projetos dev/homologação/produção separados.
- [ ] Provedor e-mail/senha e recuperação configurados.
- [ ] Backend sem chave no Electron.
- [ ] Regras e testes do Firestore aprovados.
- [ ] Claims mínimas e validadas.
- [ ] Política offline e MFA decididas.
- [ ] Rate limit e proteção contra abuso habilitados.
- [ ] Logs sem tokens/credenciais.
- [ ] Migração piloto e rollback testados.
- [ ] `admin/admin123` e bypasses removidos.

