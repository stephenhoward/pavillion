/**
 * Builds the default Content Security Policy header value.
 *
 * Includes Stripe.js and Stripe embedded checkout origins for payment
 * processing pages. In development mode, also allows the Vite dev server
 * origin for script loading and WebSocket HMR connections.
 *
 * @returns The CSP header string
 */
export function buildDefaultCSP(): string {
  const isDev = process.env.NODE_ENV === 'development';

  const directives: string[] = [
    "default-src 'self'",
    "frame-ancestors 'none'",
    `script-src 'self'${isDev ? ' http://localhost:5173' : ''} https://js.stripe.com`,
    "frame-src https://*.stripe.com",
    "img-src 'self' data:",
    `connect-src 'self' https://api.stripe.com https://errors.stripe.com https://m.stripe.com https://q.stripe.com${isDev ? ' ws://localhost:5173 http://localhost:5173' : ''}`,
  ];

  // In development, Vite injects inline styles
  if (isDev) {
    directives.push("style-src 'self' 'unsafe-inline'");
  }

  return directives.join('; ');
}
