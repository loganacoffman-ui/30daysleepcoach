import { describe, expect, it } from 'vitest';

import {
  authErrorMessage,
  isTransientAuthError,
  shouldClearPersistedSession,
} from '../mobile/auth/sessionPolicy';

describe('auth session policy', () => {
  it('keeps the persisted session when iOS reports a lost connection', () => {
    const error = new Error(
      'fetch failed: UnexpectedException: The network connection was lost.',
    );

    expect(isTransientAuthError(error)).toBe(true);
    expect(shouldClearPersistedSession(error)).toBe(false);
    expect(authErrorMessage(error)).toBe(
      'We couldn\'t reach Sleep Coach. Check your connection and try again.',
    );
  });

  it('keeps the session during rate limits and server failures', () => {
    expect(shouldClearPersistedSession({ status: 429 })).toBe(false);
    expect(shouldClearPersistedSession({ status: 503 })).toBe(false);
  });

  it('clears only definitively invalid persisted sessions', () => {
    expect(shouldClearPersistedSession({ code: 'refresh_token_not_found' })).toBe(true);
    expect(shouldClearPersistedSession({ code: 'session_not_found' })).toBe(true);
    expect(shouldClearPersistedSession({ status: 401, message: 'Temporary rejection' })).toBe(false);
  });
});
