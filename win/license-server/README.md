# Striviapp — License Server

API HTTPS de licenças (MySQL + leases Ed25519) usada pelo produto Windows em `win/`.

Ver contratos em [`../../FASE7.spec.md`](../../FASE7.spec.md) seções 15–18.

```bash
cd win/license-server
npm install
npm test
npm start
```

Não embutir este serviço no instalador Electron.
