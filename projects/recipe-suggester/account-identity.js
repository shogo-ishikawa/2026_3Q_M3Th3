export const ADMIN_EMAIL_SHA256 = 'd8d92fabafd71db21fab083c0e43e904581a9ca65436056c11a00706b8a008cb';

export async function accountIdentity(user, token, adminHash = ADMIN_EMAIL_SHA256) {
  const claims = token?.claims;
  if (!user?.uid || claims?.sub !== user.uid || claims.email_verified !== true || token.signInProvider !== 'google.com') return null;
  const email = typeof claims.email === 'string' ? claims.email : '';
  const name = user.displayName?.trim() || email.split('@')[0] || '利用者';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  const hex = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  const isAdmin = hex === adminHash;
  return {name, isAdmin};
}
