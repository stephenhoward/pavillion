import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { AccountApplicationEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

describe('AccountApplicationEntity.setInitialStatus (BeforeCreate hook)', () => {
  beforeEach(async () => {
    await db.sync({ force: true });
  });

  it('should set status to pending when no status is provided', async () => {
    const application = await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'applicant@example.com',
      message: 'I would like to apply',
    });

    expect(application.status).toBe('pending');
    expect(application.status_timestamp).toBeInstanceOf(Date);
  });

  it('should preserve caller-supplied pending_confirmation status (not clobber it)', async () => {
    // The hook must respect a caller-supplied status: applyForNewAccount sets
    // 'pending_confirmation' explicitly when the email-confirmation flow is
    // active (epic pv-l9wv) and the BeforeCreate hook must not overwrite it
    // with the 'pending' default.
    const application = await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'applicant@example.com',
      message: 'Awaiting email confirmation',
      status: 'pending_confirmation',
    });

    expect(application.status).toBe('pending_confirmation');
    expect(application.status_timestamp).toBeInstanceOf(Date);
  });

  it('should always set status_timestamp regardless of which status branch is taken', async () => {
    // status_timestamp is assigned unconditionally in the hook, so it should
    // be populated for both default-branch and caller-supplied-status rows.
    const before = Date.now();

    const defaultStatusApp = await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'default@example.com',
      message: 'Default status path',
    });

    const explicitStatusApp = await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'explicit@example.com',
      message: 'Explicit status path',
      status: 'pending_confirmation',
    });

    const after = Date.now();

    expect(defaultStatusApp.status_timestamp).toBeInstanceOf(Date);
    expect(defaultStatusApp.status_timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(defaultStatusApp.status_timestamp.getTime()).toBeLessThanOrEqual(after);

    expect(explicitStatusApp.status_timestamp).toBeInstanceOf(Date);
    expect(explicitStatusApp.status_timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(explicitStatusApp.status_timestamp.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('AccountApplicationEntity.toModel (token exclusion)', () => {
  it('should not expose confirmation_token or confirmation_token_expiration on the domain model', async () => {
    // toModel() is a pure transformation: build() (no DB write) is sufficient.
    // The AccountApplication domain model is what the admin UI receives, and
    // admins must never see applicants' confirmation tokens (security boundary
    // documented at src/server/common/entity/account.ts:95-99).
    const entity = AccountApplicationEntity.build({
      id: uuidv4(),
      email: 'applicant@example.com',
      message: 'I would like to apply',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: 'abc123-secret-token',
      confirmation_token_expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const model = entity.toModel() as unknown as Record<string, unknown>;

    // Verify standard fields survived the conversion
    expect(model.email).toBe('applicant@example.com');
    expect(model.status).toBe('pending_confirmation');

    // The token fields must not appear on the domain model under any
    // shape (snake_case, camelCase, or otherwise).
    expect(model.confirmation_token).toBeUndefined();
    expect(model.confirmationToken).toBeUndefined();
    expect(model.confirmation_token_expiration).toBeUndefined();
    expect(model.confirmationTokenExpiration).toBeUndefined();

    // Defense-in-depth: scan all enumerable keys for any token-shaped property
    // so a future field rename can't silently leak through.
    const tokenShapedKeys = Object.keys(model).filter(
      (key) => /token/i.test(key),
    );
    expect(tokenShapedKeys).toEqual([]);
  });
});
