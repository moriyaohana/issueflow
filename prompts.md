# Prompts log

## Model used

The IssueFlow backend was implemented end-to-end with **Claude Opus 4.7
(`claude-opus-4-7`)** running inside the Claude Code CLI. Opus drove both
the upfront planning pass and the 13-agent sequential implementation pass,
and the follow-up 11-agent code-review fix-up pass documented below.

## Skills used

The `.claude/skills/` directory in this repository (committed alongside the
code) contains the Superpowers skill bundles that shaped the workflow:

- `brainstorming` — surfaced the cross-cutting decisions (JWT deny-list,
  pessimistic locking on comments, cascade semantics) before writing any
  code.
- `writing-plans` — produced
  `~/.claude/plans/plan-the-full-implementation-noble-hopper.md`, the
  document followed verbatim during implementation.
- `executing-plans` — drove sequential agent slots through the plan with
  one commit per agent and verification (`npm run build`, `npm run test`,
  `npm run test:e2e`) per slot.

## Implementation prompt (verbatim, top-level)

Plan the full implementation of the IssueFlow RESTful backend (NestJS 10 + TypeScript 5 + TypeORM + PostgreSQL). The skeleton is already set up. Use the API contract in README.md as the implementation contract.

Break the work into sequential agents, one per feature section. Each agent must fully implement its section and deliver both unit tests (Jest, mocked repositories) and E2E tests (supertest) before the next agent runs.

---

### Architectural decisions (treat these as fixed — do not re-derive)

- `POST /users` accepts a `password` field; hash it with bcrypt + salt before storing. Never return `password` in any response.
- JWT logout uses a server-side DB deny-list (`invalidated_tokens` table with `jti` + `expiresAt`). JWT payload includes a `jti` (UUID). On logout, the jti is written to the table; `JwtStrategy.validate()` checks it on every request.
- Uploaded file bytes are stored as `bytea` in PostgreSQL (no filesystem, no S3).
- Ticket and comment updates use optimistic locking: a `version: number` column increments on every successful update. The PATCH body must include the current `version`; a mismatch returns 409.
- Auto-assignment candidates are all system-wide users with `role = DEVELOPER` (no explicit project membership model). Workload = count of non-DONE, non-deleted tickets assigned to the user within that specific project.
- The escalation scheduler runs via `@Cron(CronExpression.EVERY_MINUTE)` and escalates all non-DONE tickets where `dueDate < NOW()`.
- Follow the README endpoint contract exactly, including `POST /users/update/:userId` (do not normalise to PATCH).
- Apply `JwtAuthGuard` globally as an `APP_GUARD`; use a `@Public()` decorator to opt out login/register routes.

---

### Code quality standards (apply to every agent)

- Every feature lives in `src/<feature>/` with sub-folders `dto/` and `entities/`.
- Every request body has a dedicated DTO class decorated with `class-validator`. No bare `body: any`. Use `@IsEnum`, `@IsNotEmpty`, `@IsOptional`, `@IsInt`, `@IsDateString`, etc.
- `main.ts` uses `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` globally.
- Controllers are thin: validate → call service → return. All business logic lives in services.
- Services throw typed NestJS exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`). Never `throw new Error(...)`.
- Every non-trivial business rule in a service gets a JSDoc comment explaining what it enforces and why.
- Define all shared enums once in `src/common/enums/` and import from there.
- Static route segments must be declared before parameterised ones (e.g. `/tickets/export` before `/tickets/:id`) to prevent shadowing.
- `version` must be included in GET responses so clients can pass it back on PATCH.
- Audit log (`AuditLogService`) must be called after every successful mutation across all modules.

---

### Sections to plan as sequential agents

1. **Foundation** — TypeORM config, global pipes/filters, shared enums, `@Public()` decorator, `RolesGuard`, `@CurrentUser()` decorator, `ScheduleModule`.
2. **User Management** — CRUD, bcrypt password hashing, no password in responses.
3. **Authentication** — JWT login/logout (deny-list)/me, global `JwtAuthGuard`.
4. **Project Management + Soft Delete** — full CRUD, `deletedAt` via `@DeleteDateColumn`, `GET /projects/deleted` and `POST /projects/:id/restore` (ADMIN only).
5. **Ticket Management + Soft Delete + Optimistic Locking** — status forward-only lifecycle (TODO→IN_PROGRESS→IN_REVIEW→DONE), DONE tickets immutable, optimistic locking, soft delete, placeholder hooks for dependencies and auto-assign.
6. **Comment Management + @Mention Mechanism** — optimistic locking, `@username` parsing (case-insensitive), `Mention` entity, mention re-evaluation on update, `GET /users/:userId/mentions` (paginated).
7. **Audit Log** — append-only `AuditLog` entity, `AuditLogService` injectable across all modules, `GET /audit-logs` with optional filters (`entityType`, `entityId`, `action`, `actor`). Retrofit previous agents to call it.
8. **Ticket Dependencies** — `POST/GET/DELETE /tickets/:ticketId/dependencies`, same-project constraint, self-dependency prevention, block DONE transition if any blocker is not DONE.
9. **Attachment Management** — `POST/DELETE /tickets/:ticketId/attachments`, `multer` with `memoryStorage`, max 10 MB, allowed types: `image/png`, `image/jpeg`, `application/pdf`, `text/plain`, store as `bytea`.
10. **Ticket Export & Import** — `GET /tickets/export?projectId=` (CSV via `csv-stringify`), `POST /tickets/import` (multipart CSV + `projectId` form field via `csv-parse`), returns `{ created, failed, errors }`. RFC 4180-compliant quoting.
11. **Auto-Escalation Scheduler** — `@Cron` every minute, escalate non-DONE overdue tickets (LOW→MEDIUM→HIGH→CRITICAL), set `isOverdue = true` at CRITICAL, manual priority PATCH resets `isOverdue` and pauses auto-escalation for that ticket.
12. **Auto-Assignment by Workload** — on ticket creation without `assigneeId`, assign least-loaded DEVELOPER (tie-break: oldest `createdAt`), `GET /projects/:projectId/workload`, record `AUTO_ASSIGN` in audit log with `actor = SYSTEM`.
13. **Documentation** — `run.md` (install, docker, build, run, test), `prompts.md` (state model used: `claude-sonnet-4-6`, log key prompts), final `npm run build` + `npm run test` + `npm run test:e2e` all green.

## Per-agent prompts (paraphrased from the plan)

The plan file `plan-the-full-implementation-noble-hopper.md` (in
`~/.claude/plans/`) contains the full, agent-by-agent spec. Each agent
slot was driven by the corresponding section of that plan with no
re-derivation between slots.

| Agent | Focus | Key prompt anchor |
| ----- | ----- | ----------------- |
| 1 | Foundation | Shared enums, `@Public`, `@Roles`, `@CurrentUser`, TypeORM config, global pipes, test-app factory. |
| 2 | User Management | CRUD, bcrypt, no password ever in responses, soft delete. |
| 3 | Authentication | JWT login/logout/me with server-side `invalidated_tokens` deny-list; soft-deleted users rejected. |
| 4 | Projects + Soft Delete | CRUD, `GET /projects/deleted` (ADMIN), restore (ADMIN), cascade hook placeholder. |
| 5 | Tickets + Optimistic Locking | Status forward-only, DONE immutable, optimistic locking, soft delete with `deletedByCascade`, project cascade hook. |
| 6 | Comments + @Mentions | Pessimistic-locked updates, case-insensitive @mention parsing, paginated `/users/:id/mentions`. |
| 7 | Audit Log | Append-only ledger plus a retrofit pass through prior services. |
| 8 | Ticket Dependencies | Self/cross-project rejection, DONE-blocker rule. |
| 9 | Attachments | `bytea` storage, multer memory storage, mime-type allowlist, 10 MB cap. |
| 10 | Export & Import | RFC 4180 quoted CSV; partial-failure import with `{ created, failed, errors }`. |
| 11 | Auto-Escalation | Daily cron, `LOW → MEDIUM → HIGH → CRITICAL`, version bump, manual priority opts out. |
| 12 | Auto-Assignment | Least-loaded DEVELOPER tie-broken by oldest `createdAt`; workload endpoint. |
| 13 | Documentation + final green run | `run.md`, this file, end-to-end green verification. |

## Notable design clarifications during planning

Captured directly from the brainstorming pass — these became fixed
constraints across all 13 slots. A few were revised in the later
code-review fix-up pass (see the next section); the originals are kept
here verbatim with the supersession noted inline.

1. **JWT logout** uses a server-side DB deny-list with the JWT `jti`, not
   client-side token expiry alone. _(Revised in the fix-up pass: the
   deny-list TTL now uses the JWT's real `exp` claim instead of a
   `Date.now() + 24h` fallback.)_
2. **Soft-deleted user references** are preserved on existing tickets so
   historical accuracy is not destroyed; only new references are blocked.
3. **Ticket soft-delete** hard-deletes its comments and attachments;
   restore does not bring them back. _(Revised in the fix-up pass: cascade
   is now **soft**; comments / attachments / dependencies get a
   `deletedAt` stamped to the parent ticket's `deletedAt`, and ticket
   restore resurrects the matching set.)_
4. **Project soft-delete** cascade-soft-deletes its tickets and marks them
   with `deletedByCascade = true` so a later project restore knows exactly
   which tickets to resurrect (tickets manually deleted earlier stay
   deleted).
5. **Auto-escalation** runs **daily** (revised down from every-minute) to
   avoid background churn; PATCHing `priority` opts the ticket out
   (`autoEscalationPaused = true`) and clears `isOverdue`. _(Revised in
   the fix-up pass: `autoEscalationPaused` is removed entirely — the
   column, the field, the filter clause. Manual priority change still
   clears `isOverdue` but leaves the ticket eligible for re-evaluation on
   the next escalation cycle.)_
6. **Auto-assignment** considers all `DEVELOPER` users globally (there is
   no explicit project-membership model); workload is per-project,
   counting only non-DONE, non-deleted tickets.

## Code-review fix-up pass (11 sequential agents)

After the initial 13-agent implementation landed, the repo owner annotated
the tree with ~25 inline `HUMAN_CR` review comments. Those comments were
collected, clarified one round with the owner, and converted into the
single planning prompt, copied verbatim below. That prompt was fed into a
fresh planning pass which produced
`~/.claude/plans/code-review-fix-mutable-neumann.md` — followed verbatim
by 11 sequential general-purpose agents, one commit per step.

You are planning a fix-up pass on the IssueFlow NestJS service. The repo owner has annotated the code with inline review comments tagged `HUMAN_CR` (search the tree with `grep -rn "HUMAN_CR" src test`). The 25 comments below are reproduced verbatim with their file/line, the resolved intent (after a clarification round), and any scope notes.

### Ground rules for the plan

1. **Read the actual code around every comment before planning.** The `HUMAN_CR` line above the offending site is the entry point — load the surrounding function/file. Do not plan from the comment alone.
2. **Project-wide scope.** Each comment is a representative of a class of issues, not a single point fix. When you address a comment, sweep the rest of the codebase for the same smell and fold the consistent fix into the plan. E.g., `HttpStatus` enum in tests means *all* e2e specs, not only the one annotated.
3. **Group related work into single plan steps.** Several comments are entangled (locking, soft-delete cascade, audit completeness). Plan them as a single coherent change, not as N independent patches.
4. **Each step in the plan must specify:** files touched, the behavior change, the test you will add or update to prove it, and any migration / breaking-API note.
5. **Do not start coding.** Output a written plan only. The plan will be reviewed before execution.
6. **Strip `HUMAN_CR` comments as you address them.** The plan should call this out so they are not left behind. The single exception is #19 — keep the existing code, just drop the comment.
7. **Verification.** Each step should describe the unit + e2e tests that will gate it. Existing tests must continue to pass.

### Resolved comments

#### Auth

**[1] `src/auth/auth.controller.ts:38`** — pass jwt expiration to logout; make it non-optional.
- Resolution: extract `exp` from the JWT payload (already in `CurrentUserPayload` or accessible via the guard) and pass it through. Make `expirySeconds` a required parameter on `AuthService.logout`. The deny-list TTL must always be derived from the real token expiry, never the `Date.now() + 24h` fallback. Delete the fallback branch.

**[2] `src/auth/auth.service.ts:79`** — `toSeconds` duration parser smell.
- Resolution: replace the hand-rolled regex with the `ms` package (de-facto standard for NestJS configs) OR commit to plain integer seconds in config and delete the parser. Pick one and justify in the plan. Apply the same convention to any other duration-from-config sites you find while sweeping.

**[3] `src/auth/auth.service.spec.ts:74`** — magic `42` userId in `logout` test.
- Resolution: assert on `userId` end-to-end (verify it flows through to the audit record / deny-list metadata) so the literal has a purpose. Apply the same rule across all spec files: a literal in a test setup must be asserted on somewhere, or replaced with a neutral placeholder.

#### Tickets

**[4] `src/tickets/tickets.service.ts:52`** — single-letter argument names on `registerBlockersResolver(b)`, `registerAutoAssignResolver(a)`, `registerCascadeTarget(t)`.
- Resolution: rename to descriptive names (`resolver` / `target` / `cascade`). Sweep the whole service tree for one-letter parameter names introduced for brevity and fix them in the same step.

**[5] `src/tickets/tickets.service.ts:119`** — `findAllForProject` does not validate project.
- Resolution: call `projects.existsAndActive(projectId)` and throw `NotFoundException` before querying. Sweep every `findAll*` / list-style query that takes a foreign-key id and add the same guard wherever it is missing (project-id-scoped queries everywhere).

**[6] `src/tickets/tickets.service.ts:136`** — version must not be in DTO / response. Use ETag + If-Match.
- Resolution: migrate **both tickets and comments** (see [20]) to HTTP optimistic concurrency:
  - GET / POST responses set `ETag: "<version>"` (or a strong hash if you prefer; pick one and justify).
  - PATCH / PUT requires `If-Match`; mismatch returns 412 (or 409 — pick per spec and apply consistently). Missing header on a mutating request returns 428.
  - Drop `version` from `UpdateTicketDto` / `UpdateCommentDto` and from the ticket / comment response shape entirely.
  - The `version` *column* stays in the DB; only the wire contract changes.
  - Update import, escalation, and any other internal mutator to read/write the column directly.
  - Update e2e and unit tests to use headers.
  - Note any spec / README sections that describe `version` in the body and update them too.

**[7] `src/tickets/tickets.service.ts:189`** — pause-trigger question, resolved together with [13].
- Resolution: **manual priority change must NOT set `autoEscalationPaused = true`.** Instead it must clear `isOverdue` if set, leaving the ticket eligible for re-evaluation on the next escalation cycle. No other field change should affect escalation state. Investigate whether `autoEscalationPaused` (and the column) has any other writer; if not, remove the field, the column, and the filter clause in `EscalationService`. The flag on `dueDate` change that exists today should also go. Update tests accordingly.

**[8] `src/tickets/tickets.controller.ts:76`** — use `ParseIntPipe` instead of manual int parsing on `projectId` in import.
- Resolution: `@Body('projectId', ParseIntPipe) projectId: number`. Drop the manual `parseInt` + range check. Sweep all controllers for manual `parseInt(..., 10)` on `@Body` / `@Query` / `@Param` and convert.

#### Escalation

**[9] `src/tickets/escalation/escalation.service.ts:19`** — "logic is wrong."
- Resolution: the *escalation cycle* itself is correct as written (bump priority below CRITICAL; flip `isOverdue` at CRITICAL idempotently). The real fix is in [7] — *manual* priority changes must clear `isOverdue` and not pause escalation. Move/rewrite the `HUMAN_CR` note accordingly. The escalation service's cycle logic stays. The doc comment on `runEscalation` should be updated only if you remove `autoEscalationPaused`.

#### Import / Export

**[10] `src/tickets/import-export/tickets-export.service.ts:20`** + **`tickets-import.service.ts:37`** — merge into one service; eliminate "file may not exist" branch.
- Resolution: collapse `TicketsExportService` and `TicketsImportService` into a single `TicketsCsvService` class. Shared dependencies (`projects`, `audit`, `tickets`), the column list, and the row-shape converter should live in one place.
- For the file check: at the controller layer, use `ParseFilePipe` with `fileIsRequired: true` (and ideally a `FileTypeValidator` for `text/csv`). Then the service can assume `file` is present and the `if (!file)` branch goes away. Audit any other endpoint that does an "is the upload missing?" check inside the service and push the validation to the controller pipe.

#### Attachments

**[11] `src/tickets/attachments/attachments.service.ts:37`** — duplicated validations.
- Resolution: open the attachments controller, compare its validation pipes / guards to the service's `!file` and mime-type checks. Whichever checks are already enforced at the controller (e.g. via `ParseFilePipe`, `FileTypeValidator`, decorators) get removed from the service. Service keeps only checks that are invariants the controller cannot enforce (e.g. ticket existence). Apply the same controller-vs-service partition to every other service that re-validates body shape today.

#### Dependencies

**[12] `src/tickets/dependencies/dependencies.service.ts:116`** — cascade hard-delete misses audit log.
- Resolution: emit one `DEPENDENCY_DELETE` audit row per removed dependency (or one bulk row with the id list in `metadata` — pick a convention and apply it to every cascade hook, including the attachments and comments cascades, so the audit story is uniform). When the actor is null (cascade), apply [23]'s rule: `actor = SYSTEM`.

#### Users

**[13] `src/users/users.service.ts:150`** — `findByUsernamesCaseInsensitive` location.
- Resolution: **keep it in `UsersService`.** Remove only the `HUMAN_CR` comment.

**[14] `src/users/dto/create-user.dto.ts:17`** — remove password length limit.
- Resolution: delete `@MinLength(8)`. Keep `@IsNotEmpty()`. This is intentional per repo owner (take-home / demo context). Confirm no test asserts on the 8-char rule; update any that do.

#### Comments

**[15] `src/comments/comments.service.ts:43`** — "Rename to users."
- Resolution: **remove the HUMAN_CR comment, keep the code as-is.** `userRepo` is a clear name; renaming would collide with `users: UsersService` and produce churn for no gain.

**[16] `src/comments/comments.service.ts:83`** — same optimistic locking as tickets.
- Resolution: comments adopt the ETag + If-Match pattern alongside tickets per [6]. Add a `version` column to the `Comment` entity (migration), bump on save, surface via ETag, require If-Match on update / delete. Remove the existing pessimistic transaction lock — optimistic locking replaces it. The mention diff/insert can stay in a transaction, but no row lock.

**[17] `src/comments/comments.service.ts:150`** — make cascaded children soft-deletable.
- Resolution: comments, attachments, and dependencies that are removed when a ticket is soft-deleted must themselves soft-delete, not hard-delete, so a ticket undelete can restore them. Add `deletedAt` columns + migrations to `Comment`, `Attachment`, `Dependency` (any entity missing one). Switch the cascade hooks to soft-delete. Add an undelete path that restores children alongside the ticket. Update the audit metadata to record `cascade: soft` vs `cascade: hard` if both ever apply.

**[18] `src/comments/comments.service.ts:175`** — `getMentionsForUser` pagination is non-deterministic.
- Resolution: order the underlying query before slicing. Join mentions to comments (or order mentions by their backing comment's `createdAt`/`id`) and apply `ORDER BY` before `LIMIT` / `OFFSET`. Sweep every other paginated list endpoint and confirm a stable sort exists; add one wherever it does not.

**[19] `src/comments/comments.service.ts:219`** — actor is `USER` even when `actorUserId` is null.
- Resolution: `actor: actorUserId ? ActorType.USER : ActorType.SYSTEM`. Sweep every `audit.record(...)` call site for the same pattern — anywhere an audit is emitted with `performedBy: null` (or a nullable actor), the `actor` must be `SYSTEM`. This is a recurring shape; fix all instances.

**[20] `src/comments/comments.controller.ts:34`** — `actor?.id ?? null` on a non-public route.
- Resolution: comment creation is behind the JWT guard, so `actor` is guaranteed non-null. Use `actor.id` (no `??`). Sweep all non-public controllers for the same defensive `?? null` on `actor` and remove. Reserve the nullable path only for genuinely public / system endpoints.

#### Audit log

**[21] `src/audit-log/entities/audit-log.entity.ts:26`** — "Is storing metadata in postgres good?"
- Resolution: yes, for an internal audit log of this size, `jsonb` is the right call (queryable, transactional, indexable via GIN). Document the decision in a one-line comment on the column (no behavior change) and remove the `HUMAN_CR` line.

#### Tests

**[22] `test/comments.e2e-spec.ts:168`** — test exists just to silence the unused-var warning on `bob`.
- Resolution: delete this test. Find a different existing test that should legitimately reference `bob` (e.g. an actual mention assertion involving bob) and use the fixture there. If no such test exists, delete the `bob` fixture too.

**[23] `test/attachments.e2e-spec.ts:20`** — use `HttpStatus` enums.
- Resolution: **project-wide.** Replace every numeric literal status code in `test/**/*.e2e-spec.ts` and `src/**/*.spec.ts` with `HttpStatus.*` from `@nestjs/common`. Include `.expect(...)`, comparison checks, and any thrown / asserted status numbers.

### Out of scope / explicitly rejected

- [15] is a **no-op** beyond removing the comment.
- The `version`-in-DB column is **not** removed by [6] — only the wire contract changes.
- The escalation cycle (`runEscalation`) logic is **not** rewritten — only its interaction with manual priority updates changes ([7] / [9]).

### Deliverable

A written plan, organized by the groupings above (auth / tickets / escalation / import-export / attachments / dependencies / users / comments / audit / tests). For each grouping:

- One "what changes and why" paragraph (3-6 sentences).
- A bullet list of files touched.
- A bullet list of tests added or modified (with the assertion each test makes).
- Any DB migration with the column / index it adds.
- An estimate of breaking-API surface (which endpoints change request / response shape).
- Order the groupings so that the ETag/locking migration ([6] + [16]) lands before anything that touches ticket or comment mutators.

End the plan with an explicit list of all `HUMAN_CR` comments and whether each is **fixed** (code changed, comment removed) or **kept-as-is** (only the comment removed).


### Skills used in this pass

Same Superpowers bundles as the initial implementation
(`writing-plans`, `executing-plans`, `verification-before-completion`,
`subagent-driven-development`) plus:

- `brainstorming` — escalated three open architectural choices to the
  user before plan finalization (duration parser convention,
  ETag/conflict-status shape, cascade-audit row granularity).
- `verification-before-completion` — enforced lint + build + unit + e2e
  green before each commit; rolled back when a commit's verification
  failed instead of patching past it.

### Per-step prompts (paraphrased from the plan)

Each step ran in its own sub-agent slot driven by the corresponding
section of `code-review-fix-mutable-neumann.md`. Step 4 was absorbed
into Step 3 (it was only a docstring sweep on a file Step 3 already
touched), so 10 commits cover 11 steps.

| Step | Focus | Commit |
| ---- | ----- | ------ |
| 1 | ETag + `If-Match` optimistic concurrency on tickets and comments; drop body `version` from the wire contract | `eb51d48` |
| 2 | Thread real JWT `exp` into logout; replace hand-rolled duration parser with integer seconds | `0270b91` |
| 3 | Tickets housekeeping: rename one-letter hook params, guard list-for-project, `ParseIntPipe` on import, remove `autoEscalationPaused` | `cd78fae` |
| 4 | Escalation docstring sweep (absorbed into Step 3) | — |
| 5 | Merge `TicketsExportService` + `TicketsImportService` into `TicketsCsvService`; controller-side `ParseFilePipe` | `7e56eab` |
| 6 | Attachments validation moves to controller `ParseFilePipe` + `FileTypeValidator`; service drops the duplicate checks | `a4fd2c6` |
| 7 | Per-row `DEPENDENCY_DELETE` audit on cascade with `SYSTEM`/`USER` actor based on caller | `194fc7b` |
| 8 | Drop password `@MinLength(8)`; keep `findByUsernamesCaseInsensitive` in `UsersService` | `3883725` |
| 9 | Soft-cascade + restore on `Comment` / `Attachment` / `TicketDependency`; stable mention pagination; project-wide `actorOf` sweep; `actor.id` cleanup on non-public controllers | `3d306ab` |
| 10 | One-line justification comment on `audit_logs.metadata` `jsonb` column | `7e13ea5` |
| 11 | Delete dummy `bob` test; project-wide numeric → `HttpStatus.*` sweep in e2e specs | `fdf654b` |

### Migrations added by the fix-up pass

- `1700000010000-AddCommentVersion` — `comment.version INT NOT NULL DEFAULT 1`.
- `1700000011000-DropTicketAutoEscalationPaused` — drops the column whose only writer was the manual-priority branch.
- `1700000012000-AddSoftDeleteToCascadeChildren` — adds `deletedAt TIMESTAMP WITH TIME ZONE NULL` to `comments` / `attachments` / `ticket_dependencies`, plus `tickets.deletedByCascade BOOLEAN NOT NULL DEFAULT false`.

### Breaking-API changes from the fix-up pass

- `PATCH /tickets/:id`, `DELETE /tickets/:id`, `PATCH /comments/:id`, `DELETE /comments/:id` require an `If-Match` header (returns `428` if absent, `412` on mismatch). Mutating requests no longer carry `version` in the body; mutating responses no longer carry `version` in the body — the new shape is `ETag: W/"<n>"` on every single-object response.
- `JWT_EXPIRES_IN` env var format changed from a duration string (e.g. `'3600s'`) to integer seconds (`3600`).
- `autoEscalationPaused` is no longer present in the ticket response shape.
- `POST /users` now accepts passwords shorter than 8 characters (intentional for the take-home / demo scope; `@IsNotEmpty` still applies).
