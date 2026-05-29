import { ActorType } from '../common/enums/actor-type.enum';

/**
 * Resolve the `(performedBy, actor)` pair from a nullable user id.
 *
 * Conventions across the codebase:
 *   - If the caller can identify a user (JWT-authenticated path), emit
 *     `actor: USER, performedBy: <userId>`.
 *   - If the caller is `null` — system-driven (cron sweeps, cascades fired
 *     from background jobs) — emit `actor: SYSTEM, performedBy: null`.
 *
 * Always-system paths (auto-escalation, cron-triggered auto-assign) set
 * `actor: SYSTEM` unconditionally instead of going through this helper.
 */
export function actorOf(actorUserId: number | null): {
  performedBy: number | null;
  actor: ActorType;
} {
  return {
    performedBy: actorUserId,
    actor: actorUserId == null ? ActorType.SYSTEM : ActorType.USER,
  };
}
