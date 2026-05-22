import crypto from 'crypto';

// Sign a payload with HMAC-SHA256.
 
export function sign(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return `sha256=${hmac.digest('hex')}`;
}


// Verify an inbound signature 

export function verify(payload, secret, signature) {
  const expected = sign(payload, secret);
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}
