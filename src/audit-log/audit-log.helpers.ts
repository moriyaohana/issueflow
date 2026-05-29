import { ActorType } from '../common/enums/actor-type.enum';

export interface ActorMeta {
  performedBy: number | null;
  actor: ActorType;
}

/**
 * Resolve the `(performedBy, actor)` pair from a nullable user id.
 *
 * Conventions across the codebase:
 *   - If the caller can identify a user (JWT-authenticated path), emit
 *     `actor: USER, performedBy: <userId>`.
 *   - If the caller is `null` — system-driven (cron sweeps, cascades fired
 *     from background jobs) — emit `actor: SYSTEM, performedBy: null`.
 *
 * Always-system paths (auto-escalation, cron-triggered auto-assign) use
 * {@link systemActor} instead so the intent is explicit at the call site.
 */
export function actorOf(actorUserId: number | null): ActorMeta {
  return {
    performedBy: actorUserId,
    actor: actorUserId == null ? ActorType.SYSTEM : ActorType.USER,
  };
}

/**
 * Always-SYSTEM `(performedBy, actor)` pair. Use this for audit rows emitted
 * by background work (cron, cascades, auto-escalate, auto-assign, login
 * failures) where the action is not attributable to a user id.
 */
export function systemActor(): ActorMeta {
  return { performedBy: null, actor: ActorType.SYSTEM };
}
