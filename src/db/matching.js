import micromatch from 'micromatch';


export function matches(eventType, eventTypesJson) {
  const patterns = JSON.parse(eventTypesJson);
  return micromatch.isMatch(eventType, patterns);
}
