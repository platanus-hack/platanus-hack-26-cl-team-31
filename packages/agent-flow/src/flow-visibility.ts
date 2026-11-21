import { BROKER, type FlowEvent, type FlowOwner } from "./model.js";
import { eventEndpoints, resolveId, type FlowState } from "./state.js";

export function flowVisibility(shownOwners: ReadonlySet<string> | null, ownerQuery: readonly string[] | null,
  hiddenActors: ReadonlySet<string>) {
  const ownerShown = (owner: FlowOwner) => {
    if (shownOwners) return shownOwners.has(owner.key);
    if (!ownerQuery) return true;
    const key = owner.key.toLowerCase();
    return ownerQuery.some((q) => q === key || q === owner.label.toLowerCase() || q === key.split("@")[0]);
  };
  const actorVisibleIn = (state: FlowState, id: string) => {
    if (id === BROKER) return true;
    const entry = state.actors.get(id);
    if (!entry) return false;
    return ownerShown(entry.actor.owner) && !hiddenActors.has(id);
  };
  const eventVisibleIn = (state: FlowState, event: FlowEvent) => {
    const { fromId, toId } = eventEndpoints(state, event);
    if (!actorVisibleIn(state, fromId) || !actorVisibleIn(state, toId)) return false;
    const track = event.requestId ? state.requests.get(event.requestId) : undefined;
    if (track) {
      for (const id of [track.requester, track.recipient, track.human]) if (id && !actorVisibleIn(state, resolveId(state, id))) return false;
    }
    return true;
  };
  return { ownerShown, actorVisibleIn, eventVisibleIn };
}
