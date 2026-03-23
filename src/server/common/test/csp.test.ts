import { describe, it, expect, afterEach } from 'vitest';
import { buildDefaultCSP } from '@/server/common/helper/csp';

describe('buildDefaultCSP', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should include default-src self directive in production', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).toContain("default-src 'self'");
  });

  it('should include default-src self directive in development', () => {
    process.env.NODE_ENV = 'development';
    const csp = buildDefaultCSP();
    expect(csp).toContain("default-src 'self'");
  });

  it('should have default-src as the first directive', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp.startsWith("default-src 'self'")).toBe(true);
  });

  it('should include frame-ancestors none for clickjacking protection', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should include Stripe.js in script-src', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).toContain('https://js.stripe.com');
    expect(csp).toMatch(/script-src[^;]*https:\/\/js\.stripe\.com/);
  });

  it('should include Stripe wildcard in frame-src for embedded checkout', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).toContain('https://*.stripe.com');
    expect(csp).toMatch(/frame-src[^;]*https:\/\/\*\.stripe\.com/);
  });

  it('should include self in script-src', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).toMatch(/script-src[^;]*'self'/);
  });

  it('should not include Vite dev server origins in production', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).not.toContain('localhost:5173');
    expect(csp).not.toContain('connect-src');
  });

  it('should include Vite dev server in script-src in development', () => {
    process.env.NODE_ENV = 'development';
    const csp = buildDefaultCSP();
    expect(csp).toMatch(/script-src[^;]*http:\/\/localhost:5173/);
  });

  it('should include connect-src for Vite HMR WebSocket in development', () => {
    process.env.NODE_ENV = 'development';
    const csp = buildDefaultCSP();
    expect(csp).toMatch(/connect-src[^;]*ws:\/\/localhost:5173/);
  });

  it('should include style-src with unsafe-inline in development for Vite style injection', () => {
    process.env.NODE_ENV = 'development';
    const csp = buildDefaultCSP();
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it('should not include style-src unsafe-inline in production', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).not.toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it('should not include overly broad rules like unsafe-inline or unsafe-eval', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('should not use wildcard script-src or frame-src', () => {
    process.env.NODE_ENV = 'production';
    const csp = buildDefaultCSP();
    // script-src should not contain bare * (only *.stripe.com is in frame-src)
    expect(csp).not.toMatch(/script-src[^;]*\s\*/);
  });
});
