import crypto from 'crypto';

export function newId(prefix = '') {
  const rand = crypto.randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${rand}` : rand;
}
