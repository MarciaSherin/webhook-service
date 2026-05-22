export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 10_000; // 10 seconds


// Calculate the delay (in ms) before the nth retry attempt.
 
export function backoffMs(attempt) {
  const exp = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exp + jitter, 4 * 60 * 60 * 1000); // cap at 4 hours
}


//Should we retry based on the HTTP status code?
 
export function isRetryable(httpStatus, networkError = false) {
  if (networkError) return true;
  if (!httpStatus) return true; // no response = network failure
  if (httpStatus === 408 || httpStatus === 429) return true; // timeout, rate-limited
  if (httpStatus >= 500) return true; // server error
  return false; // 2xx, 3xx, and most 4xx = don't retry
}

  // Human-readable description of the policy for the dashboard.
 
export const POLICY_DESCRIPTION =
  `Up to ${MAX_ATTEMPTS} attempts. Exponential backoff starting at ${BASE_DELAY_MS / 1000}s with jitter. ` +
  `Retries on 5xx, network errors, 408, and 429. Terminal on other 4xx.`;
