import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

describe('Username Immutability', () => {
  beforeEach(async () => {
    await db.sync({ force: true });
  });

  it('should prevent username changes after initial set', async () => {
    const accountId = uuidv4();
    const initialUsername = 'alice';

    // Create account with username
    const account = await AccountEntity.create({
      id: accountId,
      username: initialUsername,
      email: 'alice@example.com',
      domain: 'events.example',
      language: 'en',
    });

    expect(account.username).toBe(initialUsername);

    // Attempt to update username
    account.username = 'bob';

    // Should throw an error because username is already set
    await expect(account.save()).rejects.toThrow('Username cannot be changed after it has been set');
  });

  it('should allow setting username on account creation', async () => {
    const accountId = uuidv4();

    const account = await AccountEntity.create({
      id: accountId,
      username: 'carol',
      email: 'carol@example.com',
      domain: 'events.example',
      language: 'en',
    });

    expect(account.username).toBe('carol');
  });

  it('should allow setting username if it was initially empty', async () => {
    const accountId = uuidv4();

    // Create account without username (accounts from invitations may start empty)
    const account = await AccountEntity.create({
      id: accountId,
      username: '',
      email: 'david@example.com',
      domain: 'events.example',
      language: 'en',
    });

    expect(account.username).toBe('');

    // Should allow setting username from empty string
    account.username = 'david';
    await account.save();

    expect(account.username).toBe('david');

    // But now changing it again should fail
    account.username = 'eve';
    await expect(account.save()).rejects.toThrow('Username cannot be changed after it has been set');
  });
});
