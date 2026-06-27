import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import { randomBytes } from 'crypto';

import { AccountEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the email-change endpoints (epic pv-91a3):
 *   - POST /api/auth/v1/email (initiate; authenticated)
 *   - POST /api/auth/v1/email/confirm/:token (confirm; anonymous)
 *
 * The governing decision is DEC-004 (privacy-first: no enumeration of
 * registered accounts). The initiate endpoint MUST be non-differential for an
 * already-registered target versus a brand-new target — same status, byte-equal
 * body, and no confirmation email dispatched on the taken path — so an
 * authenticated caller cannot probe which addresses are registered. The confirm
 * endpoint collapses every terminal failure to a single uniform
 * `{ valid: false }` (HTTP 200), mirroring accounts/api/v1/applications.ts
 * consumeConfirmationToken.
 *
 * Bead: pv-91a3.4.2
 */
describe('Email change endpoints (integration)', () => {
  let env: TestEnvironment;
  let accountService: AccountService;

  const requesterEmail = 'requester@pavillion.dev';
  const requesterPassword = 'testpassword!1';
  // A second, already-registered account whose email is the "taken" target.
  const takenEmail = 'taken@pavillion.dev';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // First account exits setup mode; both accounts back the initiate tests.
    await accountService._setupAccount(requesterEmail, requesterPassword);
    await accountService._setupAccount(takenEmail, 'testpassword!2');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  afterEach(async () => {
    sinon.restore();
    // Reset any pending email-change state left on the requester's secrets row.
    const requester = await accountService.getAccountByEmail(requesterEmail);
    if (requester) {
      const secret = await AccountSecretsEntity.findByPk(requester.id);
      if (secret) {
        secret.email_change_code = null;
        secret.email_change_expiration = null;
        secret.email_change_new_email = null;
        await secret.save();
      }
      // Ensure the requester's email was not mutated by a prior test.
      const entity = await AccountEntity.findByPk(requester.id);
      if (entity && entity.email !== requesterEmail) {
        entity.email = requesterEmail;
        await entity.save();
      }
    }
  });

  /**
   * REQUIRED non-differential regression test (epic pv-91a3, DEC-004).
   *
   * Drives POST /api/auth/v1/email for an already-registered target and a
   * brand-new target and asserts the responses are indistinguishable:
   *   (1) identical HTTP status (200) for both,
   *   (2) byte-equal {success:true} body with no differing keys,
   *   (3) the mailer is NOT called on the taken path.
   * If any of these diverge, the 409-vs-200 enumeration oracle the epic closes
   * would have crept back in.
   */
  describe('POST /email is non-differential for taken vs new target (DEC-004)', () => {
    it('returns identical 200 + byte-equal {success:true} and sends no email on the taken path', async () => {
      const token = await env.login(requesterEmail, requesterPassword);

      // Taken target: the email belongs to the second registered account.
      const takenSend = sinon.stub(EmailInterface.prototype, 'sendEmail').resolves(null);
      const takenResponse = await env.authPost(token, '/api/auth/v1/email', {
        email: takenEmail,
        password: requesterPassword,
      });
      const takenMailerCalled = takenSend.called;
      const takenStatus = takenResponse.status;
      const takenRawBody = JSON.stringify(takenResponse.body);
      sinon.restore();

      // New target: an address that belongs to no account.
      const newSend = sinon.stub(EmailInterface.prototype, 'sendEmail').resolves(null);
      const newResponse = await env.authPost(token, '/api/auth/v1/email', {
        email: 'brand-new-target@pavillion.dev',
        password: requesterPassword,
      });

      // (1) Identical status.
      expect(takenStatus).toBe(200);
      expect(newResponse.status).toBe(200);

      // (2) Byte-equal body with no differing keys.
      expect(takenRawBody).toBe(JSON.stringify(newResponse.body));
      expect(takenResponse.body).toEqual({ success: true });
      expect(newResponse.body).toEqual({ success: true });

      // (3) No email dispatched on the taken path; the available path does send.
      expect(takenMailerCalled).toBe(false);
      expect(newSend.calledOnce).toBe(true);
      expect(newSend.firstCall.args[0].emailAddress).toBe('brand-new-target@pavillion.dev');
    });

    it('returns 401 InvalidPasswordError when the password is wrong (out of scope: own-password probe)', async () => {
      const token = await env.login(requesterEmail, requesterPassword);
      sinon.stub(EmailInterface.prototype, 'sendEmail').resolves(null);

      const response = await env.authPost(token, '/api/auth/v1/email', {
        email: 'whatever@pavillion.dev',
        password: 'wrong-password',
      });

      expect(response.status).toBe(401);
      expect(response.body.errorName).toBe('InvalidPasswordError');
    });

    it('returns 400 when email or password is missing', async () => {
      const token = await env.login(requesterEmail, requesterPassword);

      const response = await env.authPost(token, '/api/auth/v1/email', { email: 'only-email@pavillion.dev' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('POST /email/confirm/:token', () => {
    /** Seed a pending email change on the requester's secrets row. */
    async function seedPendingChange(overrides: Partial<{
      token: string;
      expiresAt: Date;
      newEmail: string;
    }> = {}): Promise<string> {
      const requester = await accountService.getAccountByEmail(requesterEmail);
      if (!requester) {
        throw new Error('requester account not found');
      }
      const token = overrides.token ?? randomBytes(16).toString('hex');
      const secret = await AccountSecretsEntity.findByPk(requester.id);
      if (!secret) {
        throw new Error('requester secrets row not found');
      }
      secret.email_change_code = token;
      secret.email_change_expiration = overrides.expiresAt ?? DateTime.now().plus({ hours: 1 }).toJSDate();
      secret.email_change_new_email = overrides.newEmail ?? 'confirmed-target@pavillion.dev';
      await secret.save();
      return token;
    }

    it('happy path: a valid token commits the pending address and returns {success:true}', async () => {
      const token = await seedPendingChange({ newEmail: 'confirmed-target@pavillion.dev' });

      const response = await request(env.app).post(`/api/auth/v1/email/confirm/${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      // The account's email is now the confirmed address and the fields cleared.
      const updated = await accountService.getAccountByEmail('confirmed-target@pavillion.dev');
      expect(updated).toBeDefined();
      const secret = await AccountSecretsEntity.findByPk(updated!.id);
      expect(secret!.email_change_code).toBeNull();
      expect(secret!.email_change_expiration).toBeNull();
      expect(secret!.email_change_new_email).toBeNull();

      // Restore the requester email so afterEach/other tests see a clean state.
      const entity = await AccountEntity.findByPk(updated!.id);
      entity!.email = requesterEmail;
      await entity!.save();
    });

    it('unknown token: collapses to 200 {valid:false}', async () => {
      // Well-formed (32-hex) but matches no row.
      const response = await request(env.app).post(`/api/auth/v1/email/confirm/${randomBytes(16).toString('hex')}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
    });

    it('expired token: collapses to 200 {valid:false}', async () => {
      const token = await seedPendingChange({ expiresAt: DateTime.now().minus({ hours: 1 }).toJSDate() });

      const response = await request(env.app).post(`/api/auth/v1/email/confirm/${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
    });

    it('malformed token (not 32-hex): collapses to 200 {valid:false} with NO DB query', async () => {
      // The service validates the token shape before touching the database, so
      // a malformed token must short-circuit before any AccountSecretsEntity
      // lookup (anti-enumeration; no timing/DB signal).
      const findOneSpy = sinon.spy(AccountSecretsEntity, 'findOne');
      const findByPkSpy = sinon.spy(AccountSecretsEntity, 'findByPk');

      const response = await request(env.app).post('/api/auth/v1/email/confirm/not-a-valid-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
      expect(findOneSpy.called).toBe(false);
      expect(findByPkSpy.called).toBe(false);
    });

    it('anonymous: confirm sets no Set-Cookie header', async () => {
      const token = await seedPendingChange();

      const response = await request(env.app).post(`/api/auth/v1/email/confirm/${token}`);

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('route ordering: confirm path is not shadowed by /email', async () => {
      // /email is authenticated (loggedInOnly) and would reject an anonymous
      // POST. A 200 with the anti-enumeration body proves the confirm route
      // matched first.
      const response = await request(env.app).post(`/api/auth/v1/email/confirm/${randomBytes(16).toString('hex')}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
    });
  });
});
