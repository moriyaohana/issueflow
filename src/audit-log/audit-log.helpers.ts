import { ActorType } from '../common/enums/actor-type.enum';

export interface ActorMeta {
  performedBy: number | null;
  actor: ActorType;
}

export function actorOf(actorUserId: number | null): ActorMeta {
  return {
    performedBy: actorUserId,
    actor: actorUserId == null ? ActorType.SYSTEM : ActorType.USER,
  };
}

export function systemActor(): ActorMeta {
  return { performedBy: null, actor: ActorType.SYSTEM };
}
