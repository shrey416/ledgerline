import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

const authority = 'http://localhost:8180/realms/ledgerline';
const protocol = authority + '/protocol/openid-connect';
export const identity = new UserManager({
  authority,
  // Fixed local deployment endpoints avoid discovery on every fresh login page.
  // Keep the issuer unchanged: backend token validation uses this exact identity.
  metadata: {
    issuer: authority,
    authorization_endpoint: protocol + '/auth',
    token_endpoint: protocol + '/token',
    userinfo_endpoint: protocol + '/userinfo',
    end_session_endpoint: protocol + '/logout',
    jwks_uri: protocol + '/certs',
  },
  requestTimeoutInSeconds: 12,
  loadUserInfo: false,
  client_id: 'ledgerline-local',
  redirect_uri: window.location.origin + '/',
  post_logout_redirect_uri: window.location.origin + '/',
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
});
let callback: Promise<User> | undefined;
export async function registerAccount() {
  const metadata = await identity.metadataService.getMetadata();
  if (!metadata.authorization_endpoint) throw new Error('Registration endpoint is unavailable.');
  const registration = new UserManager({
    ...identity.settings,
    metadata: {
      ...metadata,
      authorization_endpoint: metadata.authorization_endpoint.replace(/\/auth$/, '/registrations'),
    },
  });
  return registration.signinRedirect();
}
export async function currentUser() {
  if (new URLSearchParams(location.search).has('code')) {
    const user = await (callback ??= identity.signinRedirectCallback());
    history.replaceState(null, '', location.pathname + '#overview');
    return user;
  }
  const user = await identity.getUser();
  return user && !user.expired ? user : null;
}
export async function accountRequest(path: string, method = 'GET', body?: unknown) {
  const user = await identity.getUser();
  if (!user || user.expired) throw new Error('Your session expired. Sign in again.');
  const response = await fetch('/api/v1/core/me' + path, {
    method,
    headers: { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error('Another tab changed your account. Refresh data before trying again.');
    if (response.status === 401) throw new Error('Your session expired. Sign in again.');
    let reason = 'Account service unavailable. Your change was not saved.';
    try {
      const value = await response.json();
      reason = value.detail || value.message || reason;
    } catch {
      /* Gateways can return plain text. */
    }
    throw new Error(reason);
  }
  return response.json();
}
