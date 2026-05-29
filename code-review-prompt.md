# Code Review Fix — Planning Prompt

You are planning a fix-up pass on the IssueFlow NestJS service. The repo owner has annotated the code with inline review comments tagged `HUMAN_CR` (search the tree with `grep -rn "HUMAN_CR" src test`). The 25 comments below are reproduced verbatim with their file/line, the resolved intent (after a clarification round), and any scope notes.

## Ground rules for the plan

1. **Read the actual code around every comment before planning.** The `HUMAN_CR` line above the offending site is the entry point — load the surrounding function/file. Do not plan from the comment alone.
2. **Project-wide scope.** Each comment is a representative of a class of issues, not a single point fix. When you address a comment, sweep the rest of the codebase for the same smell and fold the consistent fix into the plan. E.g., `HttpStatus` enum in tests means *all* e2e specs, not only the one annotated.
3. **Group related work into single plan steps.** Several comments are entangled (locking, soft-delete cascade, audit completeness). Plan them as a single coherent change, not as N independent patches.
4. **Each step in the plan must specify:** files touched, the behavior change, the test you will add or update to prove it, and any migration / breaking-API note.
5. **Do not start coding.** Output a written plan only. The plan will be reviewed before execution.
6. **Strip `HUMAN_CR` comments as you address them.** The plan should call this out so they are not left behind. The single exception is #19 — keep the existing code, just drop the comment.
7. **Verification.** Each step should describe the unit + e2e tests that will gate it. Existing tests must continue to pass.

## Resolved comments

### Auth

**[1] `src/auth/auth.controller.ts:38`** — pass jwt expiration to logout; make it non-optional.
- Resolution: extract `exp` from the JWT payload (already in `CurrentUserPayload` or accessible via the guard) and pass it through. Make `expirySeconds` a required parameter on `AuthService.logout`. The deny-list TTL must always be derived from the real token expiry, never the `Date.now() + 24h` fallback. Delete the fallback branch.

**[2] `src/auth/auth.service.ts:79`** — `toSeconds` duration parser smell.
- Resolution: replace the hand-rolled regex with the `ms` package (de-facto standard for NestJS configs) OR commit to plain integer seconds in config and delete the parser. Pick one and justify in the plan. Apply the same convention to any other duration-from-config sites you find while sweeping.

**[3] `src/auth/auth.service.spec.ts:74`** — magic `42` userId in `logout` test.
- Resolution: assert on `userId` end-to-end (verify it flows through to the audit record / deny-list metadata) so the literal has a purpose. Apply the same rule across all spec files: a literal in a test setup must be asserted on somewhere, or replaced with a neutral placeholder.

### Tickets

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

### Escalation

**[9] `src/tickets/escalation/escalation.service.ts:19`** — "logic is wrong."
- Resolution: the *escalation cycle* itself is correct as written (bump priority below CRITICAL; flip `isOverdue` at CRITICAL idempotently). The real fix is in [7] — *manual* priority changes must clear `isOverdue` and not pause escalation. Move/rewrite the `HUMAN_CR` note accordingly. The escalation service's cycle logic stays. The doc comment on `runEscalation` should be updated only if you remove `autoEscalationPaused`.

### Import / Export

**[10] `src/tickets/import-export/tickets-export.service.ts:20`** + **`tickets-import.service.ts:37`** — merge into one service; eliminate "file may not exist" branch.
- Resolution: collapse `TicketsExportService` and `TicketsImportService` into a single `TicketsCsvService` class. Shared dependencies (`projects`, `audit`, `tickets`), the column list, and the row-shape converter should live in one place.
- For the file check: at the controller layer, use `ParseFilePipe` with `fileIsRequired: true` (and ideally a `FileTypeValidator` for `text/csv`). Then the service can assume `file` is present and the `if (!file)` branch goes away. Audit any other endpoint that does an "is the upload missing?" check inside the service and push the validation to the controller pipe.

### Attachments

**[11] `src/tickets/attachments/attachments.service.ts:37`** — duplicated validations.
- Resolution: open the attachments controller, compare its validation pipes / guards to the service's `!file` and mime-type checks. Whichever checks are already enforced at the controller (e.g. via `ParseFilePipe`, `FileTypeValidator`, decorators) get removed from the service. Service keeps only checks that are invariants the controller cannot enforce (e.g. ticket existence). Apply the same controller-vs-service partition to every other service that re-validates body shape today.

### Dependencies

**[12] `src/tickets/dependencies/dependencies.service.ts:116`** — cascade hard-delete misses audit log.
- Resolution: emit one `DEPENDENCY_DELETE` audit row per removed dependency (or one bulk row with the id list in `metadata` — pick a convention and apply it to every cascade hook, including the attachments and comments cascades, so the audit story is uniform). When the actor is null (cascade), apply [23]'s rule: `actor = SYSTEM`.

### Users

**[13] `src/users/users.service.ts:150`** — `findByUsernamesCaseInsensitive` location.
- Resolution: **keep it in `UsersService`.** Remove only the `HUMAN_CR` comment.

**[14] `src/users/dto/create-user.dto.ts:17`** — remove password length limit.
- Resolution: delete `@MinLength(8)`. Keep `@IsNotEmpty()`. This is intentional per repo owner (take-home / demo context). Confirm no test asserts on the 8-char rule; update any that do.

### Comments

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

### Audit log

**[21] `src/audit-log/entities/audit-log.entity.ts:26`** — "Is storing metadata in postgres good?"
- Resolution: yes, for an internal audit log of this size, `jsonb` is the right call (queryable, transactional, indexable via GIN). Document the decision in a one-line comment on the column (no behavior change) and remove the `HUMAN_CR` line.

### Tests

**[22] `test/comments.e2e-spec.ts:168`** — test exists just to silence the unused-var warning on `bob`.
- Resolution: delete this test. Find a different existing test that should legitimately reference `bob` (e.g. an actual mention assertion involving bob) and use the fixture there. If no such test exists, delete the `bob` fixture too.

**[23] `test/attachments.e2e-spec.ts:20`** — use `HttpStatus` enums.
- Resolution: **project-wide.** Replace every numeric literal status code in `test/**/*.e2e-spec.ts` and `src/**/*.spec.ts` with `HttpStatus.*` from `@nestjs/common`. Include `.expect(...)`, comparison checks, and any thrown / asserted status numbers.

## Out of scope / explicitly rejected

- [15] is a **no-op** beyond removing the comment.
- The `version`-in-DB column is **not** removed by [6] — only the wire contract changes.
- The escalation cycle (`runEscalation`) logic is **not** rewritten — only its interaction with manual priority updates changes ([7] / [9]).

## Deliverable

A written plan, organized by the groupings above (auth / tickets / escalation / import-export / attachments / dependencies / users / comments / audit / tests). For each grouping:

- One "what changes and why" paragraph (3-6 sentences).
- A bullet list of files touched.
- A bullet list of tests added or modified (with the assertion each test makes).
- Any DB migration with the column / index it adds.
- An estimate of breaking-API surface (which endpoints change request / response shape).
- Order the groupings so that the ETag/locking migration ([6] + [16]) lands before anything that touches ticket or comment mutators.

End the plan with an explicit list of all `HUMAN_CR` comments and whether each is **fixed** (code changed, comment removed) or **kept-as-is** (only the comment removed).
