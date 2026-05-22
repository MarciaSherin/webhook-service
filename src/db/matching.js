import micromatch from 'micromatch';

/**
 * Given a concrete event type (e.g. "order.created") and a subscription's
 * event_types JSON array (e.g. ["order.*", "user.deleted"]), return true
 * if the subscription should receive this event.
 *
 * We use micromatch for glob-style matching so "order.*" matches "order.created"
 * but not "order.items.updated" (use "order.**" for deep matching).
 */
export function matches(eventType, eventTypesJson) {
  const patterns = JSON.parse(eventTypesJson);
  return micromatch.isMatch(eventType, patterns);
}
