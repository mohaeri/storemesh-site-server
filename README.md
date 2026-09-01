# StoreMesh Site Server

Transactional backend deployed independently at every StoreMesh site.

Version 1 uses a modular monolith with a relational database, ACID transactions, idempotency keys, row-level locking, optimistic concurrency, audit records, and a transactional outbox.

Initial modules: identity, configuration, receiving, inventory, batches, production, quality, packaging, shipping, printing, tasks, sessions, audit, and outbox.

## Environment variables

- `ALLOW_DEMO_CREDENTIALS`: set to `false` to disable development demo accounts.
- `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD`: required bootstrap credentials when demo accounts are disabled.
- `TRUST_PROXY`: defaults to `false`. Set to `true` only when the site server is behind a trusted reverse proxy that overwrites `X-Forwarded-For`; when disabled, audit IP addresses always come from the direct socket peer.
