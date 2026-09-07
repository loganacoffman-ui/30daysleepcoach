type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const definitiveSessionCodes = new Set([
  'bad_jwt',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_not_found',
  'user_not_found',
]);

const transientMessagePattern =
  /fetch failed|failed to fetch|load failed|network (?:connection|request)|connection (?:was )?lost|timed? ?out|timeout|unexpectedexception/i;

function asAuthError(error: unknown): AuthErrorLike {
  return error && typeof error === 'object' ? error as AuthErrorLike : {};
}

export function isTransientAuthError(error: unknown) {
  const candidate = asAuthError(error);
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return status === 429 || (status !== undefined && status >= 500) || transientMessagePattern.test(message);
}

export function shouldClearPersistedSession(error: unknown) {
  const candidate = asAuthError(error);
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  if (definitiveSessionCodes.has(code)) {
    return true;
  }

  return /refresh token (?:is )?(?:invalid|not found|already used)|session not found|user not found/i.test(
    message,
  );
}

export function authErrorMessage(error: unknown) {
  if (isTransientAuthError(error)) {
    return 'We couldn\'t reach Sleep Coach. Check your connection and try again.';
  }

  const candidate = asAuthError(error);
  return typeof candidate.message === 'string' && candidate.message
    ? candidate.message
    : 'Something went wrong. Please try again.';
}
