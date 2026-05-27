# IssueFlow — Run Guide

## Prerequisites

- Node.js 18+
- Docker (for the bundled Postgres in `compose.yml`)

## 1. Install dependencies

```bash
npm install
```

## 2. Start the database

```bash
docker compose up -d
```

The container exposes Postgres on `localhost:5432` using `compose.yml`'s
defaults: db / user / password all `issueflow`.

## 3. Configure environment

Copy `.env.example` to `.env`. The defaults match `compose.yml` so a local
checkout works without further edits. Tunable values:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_USER` | `issueflow` | Postgres user |
| `DB_PASSWORD` | `issueflow` | Postgres password |
| `DB_NAME` | `issueflow` | Postgres database |
| `JWT_SECRET` | `dev-secret-change-me` | HMAC secret for JWTs |
| `JWT_EXPIRES_IN` | `3600s` | JWT lifetime |
| `BCRYPT_ROUNDS` | `10` | bcrypt cost factor |

## 4. Apply migrations (production / dev runtime)

```bash
npm run migration:run
```

The app boots with `synchronize: false`; migrations are the source of truth
for schema. The E2E test suite uses `NODE_ENV=test` to enable
`synchronize: true` + `dropSchema: true` per test file — it does not
require migrations to have been run.

## 5. Run the app

```bash
npm run start:dev        # watch mode on :3000
# or
npm run build && node dist/main
```

## 6. Tests

```bash
npm run test             # unit tests (Jest, mocked repositories)
npm run test:e2e         # supertest HTTP suites against Docker Postgres
```

Both suites run serially against the same database; the E2E suite drops the
schema between files.

## 7. Smoke-checking the API

The server boots on `http://localhost:3000`. A non-authenticated `GET /`
returns `{ "status": "ok" }`.

For the rest of the API every request needs a `Bearer` JWT. The first
account in a fresh database has to be created via the registration endpoint
without a token (or seeded directly into the DB during E2E). After login
the `accessToken` from `POST /auth/login` goes into the `Authorization`
header.

Example interactive flow:

```bash
# Seed an admin (POST /users requires auth in production — for the very
# first user, hit the DB directly or temporarily allow the route).
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"admin","email":"a@b.com","fullName":"Admin","role":"ADMIN","password":"changeme-12345"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme-12345"}'

# Create a project (use the token from /auth/login)
curl -X POST http://localhost:3000/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"P","description":"D","ownerId":1}'

# Create a ticket
curl -X POST http://localhost:3000/tickets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"t","description":"d","status":"TODO","priority":"LOW","type":"BUG","projectId":1}'

# Export tickets to CSV
curl "http://localhost:3000/tickets/export?projectId=1" \
  -H "Authorization: Bearer $TOKEN" \
  --output tickets.csv

# Audit log
curl "http://localhost:3000/audit-logs?entityType=TICKET" \
  -H "Authorization: Bearer $TOKEN"
```

## Architecture notes

- **JWT logout** is enforced via a server-side `invalidated_tokens` table
  with a `jti` (UUID) on every token. `JwtStrategy.validate` checks the
  deny-list on every request.
- **Optimistic locking** on tickets: every PATCH carries the current
  `version`; mismatch → 409.
- **Pessimistic locking** on comment updates: the row is locked via
  `setLock('pessimistic_write')` for the duration of the transaction.
- **Soft delete** for users / projects / tickets via TypeORM
  `@DeleteDateColumn`. Cascading: project → tickets → comments / attachments
  / dependencies (comments and attachments are hard-deleted; their cascade
  is tracked via the `deletedByCascade` flag on tickets so project restore
  only resurrects the right rows).
- **Audit log** receives a row for every state change. System-driven
  actions (`AUTO_ASSIGN`, `AUTO_ESCALATE`, and the cascaded
  `TICKET_DELETE` / `COMMENT_DELETE` rows) carry `actor=SYSTEM` or
  `metadata.cascade=true` so reports can filter cleanly.
- **Static-vs-parameterised routes**: `/tickets/export`, `/tickets/import`,
  `/tickets/deleted`, and `/projects/deleted` are declared ahead of
  `:ticketId` / `:projectId` in their controllers to win the Express
  routing trie.
