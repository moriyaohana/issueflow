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
| `JWT_EXPIRES_IN` | `3600` | JWT lifetime in seconds (integer) |
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

## 6. Seed an initial ADMIN user

`POST /users` requires an ADMIN token, so a fresh database cannot
bootstrap itself through the HTTP API. Seed the first admin directly
against Postgres. Pick **one** of the snippets below; both are
idempotent and re-runnable.

### Option A — Docker-native one-liner (recommended)

Runs inside the Postgres container started in step 2. No new files.

```bash
ADMIN_USERNAME="admin"
ADMIN_EMAIL="admin@example.com"
ADMIN_FULLNAME="Admin"
ADMIN_PASSWORD="changeme-12345"

ADMIN_HASH=$(node -e \
  "console.log(require('bcrypt').hashSync(process.argv[1], 10))" \
  "$ADMIN_PASSWORD")

docker compose exec -T db psql -U issueflow -d issueflow \
  -v username="$ADMIN_USERNAME" \
  -v email="$ADMIN_EMAIL" \
  -v fullname="$ADMIN_FULLNAME" \
  -v hash="$ADMIN_HASH" <<'SQL'
INSERT INTO users (username, email, "fullName", role, "passwordHash")
SELECT :'username', :'email', :'fullname', 'ADMIN', :'hash'
WHERE NOT EXISTS (
  SELECT 1 FROM users
  WHERE username = :'username' AND "deletedAt" IS NULL
);
SQL
```

`bcrypt` and the cost factor (`10`) match the runtime defaults
(`BCRYPT_ROUNDS=10` in [.env.example](.env.example)), so the resulting
hash is verifiable by `POST /auth/login` without any further setup.

### Option B — Direct psql against a non-Docker Postgres

Use this if you are pointing the app at a Postgres outside `compose.yml`
(e.g. a managed instance). The shell variables and `psql -v` substitutions
are identical; only the connection differs.

```bash
ADMIN_HASH=$(node -e \
  "console.log(require('bcrypt').hashSync(process.argv[1], 10))" \
  "changeme-12345")

PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v username="admin" \
  -v email="admin@example.com" \
  -v fullname="Admin" \
  -v hash="$ADMIN_HASH" <<'SQL'
INSERT INTO users (username, email, "fullName", role, "passwordHash")
SELECT :'username', :'email', :'fullname', 'ADMIN', :'hash'
WHERE NOT EXISTS (
  SELECT 1 FROM users
  WHERE username = :'username' AND "deletedAt" IS NULL
);
SQL
```

### Verify

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme-12345"}' | jq -r '.accessToken'
```

A non-empty `accessToken` confirms the seed was successful. Save it for
the smoke-check flow in step 8.

## 7. Tests

```bash
npm run test             # unit tests (Jest, mocked repositories)
npm run test:e2e         # supertest HTTP suites against Docker Postgres
```

Both suites run serially against the same database; the E2E suite drops the
schema between files.

## 8. Smoke-checking the API

The server boots on `http://localhost:3000`. A non-authenticated `GET /`
returns `{ "status": "ok" }`.

Every other request needs a `Bearer` JWT. Step 5 seeded an admin; log
in and use the returned `accessToken` as `$TOKEN`.

```bash
# Login with the seeded admin from step 5.
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme-12345"}' | jq -r '.accessToken')

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
 