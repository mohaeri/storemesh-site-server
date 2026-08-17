# StoreMesh Site Server

Transactional backend deployed independently at every StoreMesh site.

Version 1 uses a modular monolith with a relational database, ACID transactions, idempotency keys, row-level locking, optimistic concurrency, audit records, and a transactional outbox.

Initial modules: identity, configuration, receiving, inventory, batches, production, quality, packaging, shipping, printing, tasks, sessions, audit, and outbox.

