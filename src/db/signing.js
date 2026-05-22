import crypto from 'crypto';

/**
 * Sign a payload with HMAC-SHA256.
 * Returns the signature as "sha256=<hex>" — same convention as GitHub webhooks.
 * Subscribers verify by computing the same HMAC over the raw request body.
 */
export function sign(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify an inbound signature (for future use / testing).
 */
export function verify(payload, secret, signature) {
  const expected = sign(payload, secret);
  // Timing-safe compare prevents timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}
