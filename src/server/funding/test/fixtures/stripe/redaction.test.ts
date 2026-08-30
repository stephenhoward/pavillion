import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

/**
 * Redaction guard for the committed Stripe capture fixtures
 *
 * These fixtures are real Stripe payloads in a public repository, and the
 * epic's runbook calls for re-capturing them whenever the Stripe SDK is
 * bumped — so the redaction rule in index.ts has to be enforced by something
 * that runs on its own, not by a command someone is trusted to re-run. This
 * suite is that enforcement, and it runs in PR CI: there are no git hooks in
 * this repository, so it blocks a merge rather than the local commit. A
 * capture committed unscrubbed therefore has to be fixed by amending or
 * rewriting the offending commit, not by adding one on top — which is the
 * whole reason the rule is worth automating.
 *
 * The patterns below are the mechanically checkable half of the rule. The
 * judgement half — is this free-text field identifying? — stays with the
 * sweeps documented in index.ts.
 *
 * Every assertion here reports a boolean and names the file, never the
 * offending value. A failing run of this suite is published to a public
 * Actions log, so an assertion that passed the matched credential as its
 * received value would leak it the moment the control worked — into a surface
 * that, unlike a local commit, cannot be amended away.
 */

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The captures that must exist, by filename
 *
 * Listed rather than counted so that a rename is caught as precisely as a
 * deletion, and so an unexpected extra file cannot ride along unchecked.
 * Without this, a move that emptied the directory would turn every it.each
 * below into a silent no-op.
 */
const EXPECTED_FIXTURES = [
  'checkout-session-completed.json',
  'customer-subscription-deleted.json',
  'customer-subscription-updated.json',
  'invoice-paid.json',
  'invoice-payment-failed.json',
  'invoice-payment-succeeded.json',
];

/**
 * Any URL whose host is Stripe's
 *
 * Stripe serves bearer-capability links from several hosts — invoice.stripe.com
 * and pay.stripe.com (invoice links), checkout.stripe.com (a session's `url`)
 * and billing.stripe.com (portal sessions) — and each is unauthenticated by
 * design, because the token in the path is the authorization and the link is
 * meant to be emailed to a customer. Matching the whole domain rather than an
 * enumerated host list keeps this a flat rule: a re-capture taken earlier in a
 * session's lifecycle, or of checkout.session.expired, carries a live
 * checkout.stripe.com link that an enumerated list written today would miss.
 * Redacted placeholders use the reserved .invalid TLD precisely so that no
 * allowlist of approved exceptions is needed here.
 */
const URL_HOST_PATTERN = /https?:\/\/([A-Za-z0-9.-]+)/g;

function isStripeHost(host: string): boolean {
  return host === 'stripe.com' || host.endsWith('.stripe.com');
}

function hasStripeUrl(contents: string): boolean {
  // Fresh matcher per call: URL_HOST_PATTERN carries the g flag, so its
  // lastIndex would otherwise persist between files.
  for (const match of contents.matchAll(URL_HOST_PATTERN)) {
    if (isStripeHost(match[1])) {
      return true;
    }
  }
  return false;
}

/**
 * Stripe API key prefixes, live and test alike
 *
 * Test keys are checked too: a test key is still a credential for the sandbox,
 * and the point of a guard is that nobody has to judge which kind slipped in.
 *
 * Deliberately un-flagged (no /g): these are used with .test(), which advances
 * lastIndex on a global regex and would then alternate between true and false
 * across successive calls.
 */
const STRIPE_KEY_PATTERN = /\b(?:sk|rk|whsec|pk)_[A-Za-z0-9_]{4,}/;

/**
 * Stripe client secrets
 *
 * Matched on the shared infix rather than a prefix list, because the prefix
 * varies with the object that issued it (cs_..._secret_..., pi_..._secret_...,
 * seti_..._secret_...) and a prefix list would repeat the failure this whole
 * guard exists to prevent: a documented rule the pattern cannot actually
 * enforce. It matters for Pavillion specifically because DEC-007 puts checkout
 * on Stripe's embedded flow, where a session's client_secret is the live value
 * the browser mounts against. It is null in every current capture; a
 * re-capture taken before completion would carry a real one.
 */
const CLIENT_SECRET_PATTERN = /_secret_[A-Za-z0-9]{6,}/;

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort();
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

describe('Stripe capture fixture redaction', () => {
  it('should find exactly the expected captures', () => {
    expect(fixtureFiles()).toEqual(EXPECTED_FIXTURES);
  });

  it.each(EXPECTED_FIXTURES)('%s should contain no Stripe-hosted URL', (name) => {
    expect(
      hasStripeUrl(readFixture(name)),
      `${name} contains a URL on a stripe.com host (value withheld — a failing CI log is public). Stripe's invoice, checkout and portal links are bearer capabilities: the path token is the credential. Redact to the .invalid placeholders before committing, and amend rather than add a commit — see the redaction rule in index.ts.`,
    ).toBe(false);
  });

  it.each(EXPECTED_FIXTURES)('%s should contain no Stripe API key', (name) => {
    expect(
      STRIPE_KEY_PATTERN.test(readFixture(name)),
      `${name} contains a Stripe API key (value withheld — a failing CI log is public). Remove it and amend rather than add a commit — see the redaction rule in index.ts.`,
    ).toBe(false);
  });

  it.each(EXPECTED_FIXTURES)('%s should contain no Stripe client secret', (name) => {
    expect(
      CLIENT_SECRET_PATTERN.test(readFixture(name)),
      `${name} contains a Stripe client secret (value withheld — a failing CI log is public). Remove it and amend rather than add a commit — see the redaction rule in index.ts.`,
    ).toBe(false);
  });

  // Guards the guard. Every assertion above is a negative, so a pattern that
  // silently stopped matching — a bad refactor, a stray flag, a narrowed
  // character class — would leave this whole suite green while enforcing
  // nothing. These pin that each pattern still fires, and still discriminates.
  describe('detection patterns', () => {
    it('should detect a Stripe-hosted URL on any capability host', () => {
      expect(hasStripeUrl('"url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3"')).toBe(true);
      expect(hasStripeUrl('"hosted_invoice_url": "https://invoice.stripe.com/i/acct_x/test_tok?s=ap"')).toBe(true);
      expect(hasStripeUrl('"invoice_pdf": "https://pay.stripe.com/invoice/acct_x/test_tok/pdf"')).toBe(true);
      expect(hasStripeUrl('"url": "https://billing.stripe.com/p/session/test_tok"')).toBe(true);
    });

    it('should not flag the redacted placeholders or non-Stripe hosts', () => {
      expect(hasStripeUrl('"hosted_invoice_url": "https://invoice.stripe.invalid/i/acct_redacted/test_redacted?s=ap"')).toBe(false);
      expect(hasStripeUrl('"return_url": "http://localhost:3000/calendar/x/manage"')).toBe(false);
      expect(hasStripeUrl('"url": "/v1/invoices/in_123/lines"')).toBe(false);

      // A lookalike host must not satisfy the suffix check.
      expect(hasStripeUrl('"url": "https://notstripe.com/x"')).toBe(false);
    });

    it('should detect every Stripe API key prefix, live and test', () => {
      expect(STRIPE_KEY_PATTERN.test('"key": "sk_live_abcd1234"')).toBe(true);
      expect(STRIPE_KEY_PATTERN.test('"key": "sk_test_abcd1234"')).toBe(true);
      expect(STRIPE_KEY_PATTERN.test('"key": "rk_test_abcd1234"')).toBe(true);
      expect(STRIPE_KEY_PATTERN.test('"key": "pk_live_abcd1234"')).toBe(true);
      expect(STRIPE_KEY_PATTERN.test('"key": "whsec_abcd1234"')).toBe(true);
    });

    it('should not flag ordinary Stripe object ids as keys', () => {
      expect(STRIPE_KEY_PATTERN.test('"id": "sub_1U9qOYLM7gkEdqMfd7WoHNz7"')).toBe(false);
      expect(STRIPE_KEY_PATTERN.test('"id": "cus_VAAjKPe5TGoA44"')).toBe(false);

      // The prefix must start a word: an embedded "sk_" is not a key.
      expect(STRIPE_KEY_PATTERN.test('"field": "task_abcd1234"')).toBe(false);
    });

    it('should detect a client secret whatever object issued it', () => {
      expect(CLIENT_SECRET_PATTERN.test('"client_secret": "cs_test_a1b2_secret_XyZ123abc"')).toBe(true);
      expect(CLIENT_SECRET_PATTERN.test('"client_secret": "pi_3ABC_secret_XyZ123abc"')).toBe(true);
      expect(CLIENT_SECRET_PATTERN.test('"client_secret": "seti_1ABC_secret_XyZ123abc"')).toBe(true);
    });

    it('should not flag a bare session id as a client secret', () => {
      expect(CLIENT_SECRET_PATTERN.test('"id": "cs_test_a1b2c3d4e5"')).toBe(false);
      expect(CLIENT_SECRET_PATTERN.test('"client_secret": null')).toBe(false);
    });
  });
});
