import { describe, it, expect } from 'vitest';
import { Account } from '@/common/model/account';

describe('Account Model', () => {

  it('should create instance with required properties', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');

    expect(account.id).toBe('test-id');
    expect(account.username).toBe('testuser');
    expect(account.email).toBe('test@example.com');
    expect(account.displayName).toBe(null);
    expect(account.roles).toBe(null);
    expect(account.calendarLanguages).toEqual(['en']);
    expect(account.language).toBe('en');
  });

  it('should allow setting displayName', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.displayName = 'Test User Display Name';

    expect(account.displayName).toBe('Test User Display Name');
  });

  it('should allow clearing displayName with null', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.displayName = 'Test User';
    account.displayName = null;

    expect(account.displayName).toBe(null);
  });

  it('toObject: should include displayName when set', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.displayName = 'Test User Display';
    account.roles = ['user', 'admin'];

    const obj = account.toObject();

    expect(obj).toEqual({
      id: 'test-id',
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User Display',
      roles: ['user', 'admin'],
    });
  });

  it('toObject: should include displayName as null when not set', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.roles = ['user'];

    const obj = account.toObject();

    expect(obj).toEqual({
      id: 'test-id',
      username: 'testuser',
      email: 'test@example.com',
      displayName: null,
      roles: ['user'],
    });
  });

  it('fromObject: should create instance with displayName', () => {
    const obj = {
      id: 'test-id',
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User Display',
      roles: ['user', 'admin'],
    };

    const account = Account.fromObject(obj);

    expect(account.id).toBe('test-id');
    expect(account.username).toBe('testuser');
    expect(account.email).toBe('test@example.com');
    expect(account.displayName).toBe('Test User Display');
    expect(account.roles).toEqual(['user', 'admin']);
  });

  it('fromObject: should handle null displayName', () => {
    const obj = {
      id: 'test-id',
      username: 'testuser',
      email: 'test@example.com',
      displayName: null,
      roles: ['user'],
    };

    const account = Account.fromObject(obj);

    expect(account.displayName).toBe(null);
  });

  it('fromObject: should handle missing displayName field', () => {
    const obj = {
      id: 'test-id',
      username: 'testuser',
      email: 'test@example.com',
      roles: ['user'],
    };

    const account = Account.fromObject(obj);

    expect(account.displayName).toBe(null);
  });

  it('should maintain data integrity through toObject-fromObject conversion with displayName', () => {
    const original = new Account('round-trip-id', 'testuser', 'test@example.com');
    original.displayName = 'Test Display Name';
    original.roles = ['user', 'admin'];

    const obj = original.toObject();
    const roundTrip = Account.fromObject(obj);

    expect(roundTrip.id).toBe(original.id);
    expect(roundTrip.username).toBe(original.username);
    expect(roundTrip.email).toBe(original.email);
    expect(roundTrip.displayName).toBe(original.displayName);
    expect(roundTrip.roles).toEqual(original.roles);
  });

  it('should maintain data integrity through toObject-fromObject conversion without displayName', () => {
    const original = new Account('round-trip-id', 'testuser', 'test@example.com');
    original.roles = ['user'];

    const obj = original.toObject();
    const roundTrip = Account.fromObject(obj);

    expect(roundTrip.id).toBe(original.id);
    expect(roundTrip.username).toBe(original.username);
    expect(roundTrip.email).toBe(original.email);
    expect(roundTrip.displayName).toBe(null);
    expect(roundTrip.roles).toEqual(original.roles);
  });

  it('clone: should create deep copy with displayName', () => {
    const original = new Account('test-id', 'testuser', 'test@example.com');
    original.displayName = 'Original Display Name';
    original.roles = ['user', 'admin'];

    const clone = original.clone();

    expect(clone).not.toBe(original);
    expect(clone.id).toBe(original.id);
    expect(clone.username).toBe(original.username);
    expect(clone.email).toBe(original.email);
    expect(clone.displayName).toBe(original.displayName);
    expect(clone.roles).toEqual(original.roles);
  });

  it('hasRole: should work correctly with roles', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.roles = ['user', 'admin'];

    expect(account.hasRole('user')).toBe(true);
    expect(account.hasRole('admin')).toBe(true);
    expect(account.hasRole('superadmin')).toBe(false);
  });

  it('hasRole: should return false when roles is null', () => {
    const account = new Account('test-id', 'testuser', 'test@example.com');

    expect(account.hasRole('user')).toBe(false);
    expect(account.hasRole('admin')).toBe(false);
  });
});
