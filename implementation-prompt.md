Plan the full implementation of the IssueFlow RESTful backend (NestJS 10 + TypeScript 5 + TypeORM + PostgreSQL). The skeleton is already set up. Use the API contract in README.md as the implementation contract.

Break the work into sequential agents, one per feature section. Each agent must fully implement its section and deliver both unit tests (Jest, mocked repositories) and E2E tests (supertest) before the next agent runs.

---

## Architectural decisions (treat these as fixed — do not re-derive)

- `POST /users` accepts a `password` field; hash it with bcrypt + salt before storing. Never return `password` in any response.
- JWT logout uses a server-side DB deny-list (`invalidated_tokens` table with `jti` + `expiresAt`). JWT payload includes a `jti` (UUID). On logout, the jti is written to the table; `JwtStrategy.validate()` checks it on every request.
- Uploaded file bytes are stored as `bytea` in PostgreSQL (no filesystem, no S3).
- Ticket and comment updates use optimistic locking: a `version: number` column increments on every successful update. The PATCH body must include the current `version`; a mismatch returns 409.
- Auto-assignment candidates are all system-wide users with `role = DEVELOPER` (no explicit project membership model). Workload = count of non-DONE, non-deleted tickets assigned to the user within that specific project.
- The escalation scheduler runs via `@Cron(CronExpression.EVERY_MINUTE)` and escalates all non-DONE tickets where `dueDate < NOW()`.
- Follow the README endpoint contract exactly, including `POST /users/update/:userId` (do not normalise to PATCH).
- Apply `JwtAuthGuard` globally as an `APP_GUARD`; use a `@Public()` decorator to opt out login/register routes.

---

## Code quality standards (apply to every agent)

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

## Sections to plan as sequential agents

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
