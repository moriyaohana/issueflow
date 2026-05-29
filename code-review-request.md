# Plan a code review of the IssueFlow backend

You are planning a code review of the IssueFlow NestJS/TypeScript backend at `/home/denzo/tdp-assignment/issueflow`. This is a take-home assignment (TDP 2026) implementing a ticket-management platform: users, projects, tickets, comments, dependencies, attachments, audit log, CSV import/export, soft delete, @mentions, auto-escalation, and auto-assignment. Persistence is PostgreSQL via TypeORM.

The review has **three independent dimensions**. Plan how to cover all three — don't collapse them into one pass.

## Dimension 1 — Spec conformance against `README.md`

For every endpoint table in `README.md` (Users, Authentication, Projects, Tickets, Comments, Audit Log, Dependencies, Attachments, Soft Delete, Mentions, Workload), verify the implementation matches **exactly**:
- HTTP method and path (note `POST /users/update/:userId` is non-standard — check the controller actually exposes it that way)
- Request body shape, required vs. optional fields
- Response status code and response body shape (field names, nesting, types, ISO-8601 dates, `isOverdue` flag, `mentionedUsers` arrays, pagination envelope for mentions, etc.)
- Query parameters (`projectId`, `entityType`, `entityId`, `action`, `actor`, `page`, `pageSize`)
- Auth/role gates implied by the spec (e.g. soft-deleted list + restore are ADMIN-only)

## Dimension 2 — Requirements coverage against the PDF (`TDP_issueflow_requirements.pdf`)

Cross-check every feature & constraint in sections 2–3 is actually implemented and enforced:

- **Users (2.1):** role enum (`ADMIN`/`DEVELOPER`); soft-delete (per the PDF margin note).
- **Auth (2.2):** JWT login, logout invalidation (deny-list or stateless), `/auth/me`, **all endpoints protected**.
- **Projects (2.3) & Tickets (2.4):** CRUD; ticket status/priority/type enums; **no updates once DONE**; **forward-only status transitions** (`TODO → IN_PROGRESS → IN_REVIEW → DONE`); **concurrent-update protection** — note this project uses **ETag + `If-Match` headers** for optimistic concurrency on tickets and comments, not a body `version` field. Verify the headers are emitted on GETs and required on PATCH/DELETE, with `412 Precondition Failed` on mismatch.
- **Comments (2.5):** same concurrent-edit protection as tickets.
- **Audit log (3.1):** every state-changing action is logged — manual *and* system-triggered (auto-assign, auto-escalation). Filtering by `entityType`/`entityId`/`action`/`actor` works.
- **Dependencies (3.2):** add/list/remove; both tickets in the same project; **a ticket cannot transition to DONE if it has unresolved blockers**.
- **Attachments (3.3):** 10 MB max enforced; allowed MIME types only (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`); rejects others with a clear error.
- **Export/Import (3.4):** CSV correctly handles embedded commas and quotes (round-trip a string like `He said, "hi"`); import returns `{ created, failed, errors[] }`.
- **Soft delete (3.5):** soft-deleted records hidden from default listings; restore + deleted-list endpoints are ADMIN-only; verify cascade-delete behavior on the `deletedByCascade` flag (per recent commit).
- **Mentions (3.6):** case-insensitive username matching; mention list re-evaluated on comment update (added/removed mentions reconciled); `GET /users/:userId/mentions` returns newest first, paginated.
- **Auto-escalation (3.7):** scheduler runs; only overdue tickets with `dueDate` set; one-level promotion per cycle; idempotent at CRITICAL; sets `isOverdue` only when CRITICAL+overdue; **manual priority change clears `isOverdue` and resets state**; never changes `status`.
- **Auto-assignment (3.8):** triggered **only on creation when `assigneeId` is absent**; DEVELOPER-only candidates (ADMIN excluded); lowest open (non-DONE) ticket count in that project wins; ties broken by **user registration order, oldest first**; no developers → `assigneeId = null` without error; audit log entry with `actor=SYSTEM`, `action=AUTO_ASSIGN`.

For each feature, plan a check that confirms both the **happy path** and the **constraint** is enforced (not just present).

## Dimension 3 — Code quality, code smells, and clean code

Plan a sweep for:
- **Duplication** across services/controllers (e.g. repeated permission checks, repeated soft-delete filters, repeated audit-log writes — should likely be interceptors/decorators/guards/shared helpers).
- **Long methods / mixed responsibilities** in services (esp. tickets, comments, import).
- **Dead code, unused exports, stale TODOs, leftover scaffolding**.
- **Magic numbers / hard-coded strings** that should be enum constants or config.
- **NestJS idiom hygiene**: DTO validation with `class-validator`, `ValidationPipe` setup, proper exception filters, no leaking entities through controllers (use response DTOs), correct module boundaries, guards on protected routes, no business logic in controllers.
- **TypeORM concerns**: N+1 queries (mentions, dependencies, workload), transactions where multi-write atomicity matters (auto-assign + audit log; mention reconciliation on comment update; cascade soft-delete), correct use of relations / lazy loading.
- **Error handling**: informative, structured errors using NestJS `HttpException` subclasses with consistent payload; not leaking stack traces or internal entity IDs in messages; using the `HttpStatus` enum (project-wide preference per recent commit) rather than numeric literals.
- **Security**: authorization checks consistently applied; no IDOR (e.g. user A editing user B's comment); JWT logout actually invalidates; password hashing if applicable; ADMIN-only routes guarded.
- **Concurrency / race conditions** beyond ETag (e.g. workload computation under concurrent ticket creation).
- **Naming / readability**: clear identifier names, single-responsibility files, consistent file/folder conventions.

## Test coverage review

Plan a pass over the `test/` directory and any colocated `*.spec.ts`:
- Is every requirement above covered by **at least one test** (unit or e2e)?
- Are the **constraints** tested (forward-only status, no update after DONE, ETag mismatch → 412, CSV quoting, mention case-insensitivity, escalation idempotency at CRITICAL, auto-assign tie-breaking by registration order, attachment size/MIME rejection, ADMIN-only routes for non-ADMINs)?
- Are auth/role boundaries tested (ADMIN vs DEVELOPER vs unauthenticated)?
- Are tests using real DB (per project preference — no mocked repositories for integration tests)?
- Are there gaps in negative-path testing (400/403/404/409/412)?

## Deliverable

The review output is a **single flat markdown list of concrete, actionable issues and suggestions** — one finding per bullet. The list will be handed directly to a fixer agent, so each bullet must be self-contained:

- State the problem in one sentence.
- Cite the exact file path (and line range if helpful) where the fix belongs, or list multiple files when the same fix sweeps the codebase.
- State the expected fix or behavior change concretely enough that the fixer doesn't have to re-derive it.
- If the fix needs a test, name the test file and what the test must assert.

Do **not** include: severity tags, triage categories, inline comments in the source tree, prose section intros, or "considerations." Just the list. Group bullets loosely by area (Spec conformance / Requirements / Code quality / Tests) using `##` headings if it helps the fixer, but no nested sub-headings.

Do **not** perform the review yourself — just plan how the reviewer will execute it and what the final list should look like. The reviewer who executes the plan will read the code and produce the list.
