# Prompts log

## Model used

The IssueFlow backend was implemented end-to-end with **Claude Opus 4.7
(`claude-opus-4-7`)** running inside the Claude Code CLI. Opus drove both
the upfront planning pass and the 13-agent sequential implementation pass.

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
constraints across all 13 slots:

1. **JWT logout** uses a server-side DB deny-list with the JWT `jti`, not
   client-side token expiry alone.
2. **Soft-deleted user references** are preserved on existing tickets so
   historical accuracy is not destroyed; only new references are blocked.
3. **Ticket soft-delete** hard-deletes its comments and attachments;
   restore does not bring them back.
4. **Project soft-delete** cascade-soft-deletes its tickets and marks them
   with `deletedByCascade = true` so a later project restore knows exactly
   which tickets to resurrect (tickets manually deleted earlier stay
   deleted).
5. **Auto-escalation** runs **daily** (revised down from every-minute) to
   avoid background churn; PATCHing `priority` opts the ticket out
   (`autoEscalationPaused = true`) and clears `isOverdue`.
6. **Auto-assignment** considers all `DEVELOPER` users globally (there is
   no explicit project-membership model); workload is per-project,
   counting only non-DONE, non-deleted tickets.
