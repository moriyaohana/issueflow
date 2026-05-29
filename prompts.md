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

> Plan the full implementation of the IssueFlow RESTful backend
> (NestJS 10 + TypeScript 5 + TypeORM + PostgreSQL). The skeleton is
> already set up. Use the API contract in README.md as the implementation
> contract. Break the work into sequential agents, one per feature
> section. Each agent must fully implement its section and deliver both
> unit tests (Jest, mocked repositories) and E2E tests (supertest) before
> the next agent runs.

The full source of this prompt (with the fixed architectural decisions
and code-quality standards) is committed at
[implementation-prompt.md](implementation-prompt.md). The condensed
sequencing instructions live at [plan.md](plan.md).

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
single planning prompt at
[code-review-prompt.md](code-review-prompt.md). That prompt was fed into a
fresh planning pass which produced
`~/.claude/plans/code-review-fix-mutable-neumann.md` — followed verbatim
by 11 sequential general-purpose agents, one commit per step.

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

### Top-level fix-up prompt (verbatim)

> You are planning a fix-up pass on the IssueFlow NestJS service. The
> repo owner has annotated the code with inline review comments tagged
> `HUMAN_CR` (search the tree with `grep -rn "HUMAN_CR" src test`). The
> 25 comments below are reproduced verbatim with their file/line, the
> resolved intent (after a clarification round), and any scope notes.
> Group related work into single plan steps. Each step in the plan must
> specify: files touched, the behavior change, the test you will add or
> update to prove it, and any migration / breaking-API note. Do not start
> coding. Output a written plan only.

The full source of this prompt (with all 23 resolved comments and ground
rules) is committed at [code-review-prompt.md](code-review-prompt.md).

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
