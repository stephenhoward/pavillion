import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Cache } from '@/server/activitypub/helper/cache';

describe('Cache', () => {
  let cache: Cache<string>;
  let clock: sinon.SinonFakeTimers;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    // Create a fake clock
    clock = sinon.useFakeTimers();

    // Create a new cache instance before each test
    cache = new Cache<string>(1000); // 1 second TTL for tests
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
    cache.clear();
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should respect the default TTL', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // Advance time to just before expiration
    clock.tick(999);
    expect(cache.get('key1')).toBe('value1');

    // Advance time past expiration
    clock.tick(2);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should respect custom TTL', () => {
    cache.set('shortTTL', 'value1', 500); // 500ms TTL
    cache.set('longTTL', 'value2', 2000); // 2000ms TTL

    // Advance time to where short TTL expires but long TTL is still valid
    clock.tick(750);
    expect(cache.get('shortTTL')).toBeUndefined();
    expect(cache.get('longTTL')).toBe('value2');

    // Advance time to where both TTLs expire
    clock.tick(1500);
    expect(cache.get('longTTL')).toBeUndefined();
  });

  it('should allow deleting specific keys', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.delete('key1');

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });

  it('should allow clearing the entire cache', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.clear();

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should automatically clean up expired items on get', () => {
    // Create a spy on Map.prototype.delete
    const deleteSpy = sandbox.spy(Map.prototype, 'delete');

    cache.set('expiringKey', 'value', 100);

    // Advance time past expiration
    clock.tick(200);

    // Get should trigger cleanup
    cache.get('expiringKey');

    // Expect delete to have been called once
    expect(deleteSpy.calledOnce).toBe(true);
    expect(deleteSpy.calledWith('expiringKey')).toBe(true);
  });

  it('should not clean up non-expired items', () => {
    const deleteSpy = sandbox.spy(Map.prototype, 'delete');

    cache.set('validKey', 'value', 1000);

    // Advance time but not past expiration
    clock.tick(500);

    // Get should not trigger cleanup
    cache.get('validKey');

    // Delete should not have been called
    expect(deleteSpy.called).toBe(false);
  });
});
