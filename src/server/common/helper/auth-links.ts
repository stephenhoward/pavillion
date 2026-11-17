/**
 * Paths to client auth pages, for links the server emits (emails). Shared by
 * every server domain that links to them, so no domain imports another for
 * them (DEC-003). The client serves these under `/auth/*` (DEC-010).
 *
 * Each literal returned here is pinned on both sides of the layer boundary,
 * by `src/server/common/test/helper/auth-links.test.ts` and
 * `src/client/test/routing/auth-links-contract.test.ts`. All builders return
 * a path only: callers add the origin with `publicUrl`, and any `?code=`
 * query stays in the template that composes it.
 */

/**
 * Path to the login page, the client route `login`.
 *
 * @returns `/auth/login`
 */
export function loginPath(): string {
  return '/auth/login';
}

/**
 * Path to the forgot-password page, the client route `forgot_password`.
 *
 * @returns `/auth/forgot`
 */
export function forgotPasswordPath(): string {
  return '/auth/forgot';
}

/**
 * Path to the set/reset password page, the client route `reset_password`.
 *
 * @returns `/auth/password`
 */
export function resetPasswordPath(): string {
  return '/auth/password';
}

/**
 * Path to the invitation acceptance page, the client route `accept_invite`.
 *
 * @returns `/auth/invitation`
 */
export function acceptInvitePath(): string {
  return '/auth/invitation';
}

/**
 * Path to the application confirmation page, the client route
 * `apply-confirm`.
 *
 * @param token - The confirmation token
 * @returns `/auth/apply/confirm/<token>`, with the token encoded as one segment
 */
export function applyConfirmPath(token: string): string {
  return `/auth/apply/confirm/${encodeURIComponent(token)}`;
}

/**
 * Path to the email-change confirmation page, the client route
 * `email-confirm`.
 *
 * @param token - The confirmation token
 * @returns `/auth/email/confirm/<token>`, with the token encoded as one segment
 */
export function emailConfirmPath(token: string): string {
  return `/auth/email/confirm/${encodeURIComponent(token)}`;
}
