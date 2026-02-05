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
    cache.set('validKey', 'value', 1000);

    // Advance time but not past expiration
    clock.tick(500);

    // Get should return the value (not expired)
    const result = cache.get('validKey');
    expect(result).toBe('value');

    // Item should still be in cache
    expect(cache.size).toBe(1);
  });

  describe('LRU eviction', () => {
    let lruCache: Cache<string>;

    beforeEach(() => {
      // Create a cache with max size of 3
      lruCache = new Cache<string>(1000, 3);
    });

    afterEach(() => {
      lruCache.clear();
    });

    it('should allow setting up to maxSize items without eviction', () => {
      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      expect(lruCache.size).toBe(3);
      expect(lruCache.get('key1')).toBe('value1');
      expect(lruCache.get('key2')).toBe('value2');
      expect(lruCache.get('key3')).toBe('value3');
    });

    it('should evict oldest item when exceeding maxSize', () => {
      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');
      lruCache.set('key4', 'value4'); // Should evict key1

      expect(lruCache.size).toBe(3);
      expect(lruCache.get('key1')).toBeUndefined();
      expect(lruCache.get('key2')).toBe('value2');
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
    });

    it('should update LRU order when accessing an item', () => {
      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      // Access key1 to make it most recently used
      lruCache.get('key1');

      // Add key4, which should evict key2 (oldest)
      lruCache.set('key4', 'value4');

      expect(lruCache.size).toBe(3);
      expect(lruCache.get('key1')).toBe('value1'); // Still there
      expect(lruCache.get('key2')).toBeUndefined(); // Evicted
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
    });

    it('should update LRU order when updating an existing key', () => {
      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      // Update key1 to make it most recently used
      lruCache.set('key1', 'updated1');

      // Add key4, which should evict key2 (oldest)
      lruCache.set('key4', 'value4');

      expect(lruCache.size).toBe(3);
      expect(lruCache.get('key1')).toBe('updated1'); // Still there
      expect(lruCache.get('key2')).toBeUndefined(); // Evicted
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
    });

    it('should handle multiple evictions when needed', () => {
      // Fill cache
      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      // Access key3 to make it most recently used
      lruCache.get('key3');

      // Add two more items
      lruCache.set('key4', 'value4');
      lruCache.set('key5', 'value5');

      expect(lruCache.size).toBe(3);
      expect(lruCache.get('key1')).toBeUndefined(); // Evicted
      expect(lruCache.get('key2')).toBeUndefined(); // Evicted
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
      expect(lruCache.get('key5')).toBe('value5');
    });

    it('should work with maxSize of 0 (unlimited)', () => {
      const unlimitedCache = new Cache<string>(1000, 0);

      for (let i = 0; i < 100; i++) {
        unlimitedCache.set(`key${i}`, `value${i}`);
      }

      expect(unlimitedCache.size).toBe(100);
      expect(unlimitedCache.get('key0')).toBe('value0');
      expect(unlimitedCache.get('key99')).toBe('value99');
    });

    it('should respect size property', () => {
      expect(lruCache.size).toBe(0);

      lruCache.set('key1', 'value1');
      expect(lruCache.size).toBe(1);

      lruCache.set('key2', 'value2');
      expect(lruCache.size).toBe(2);

      lruCache.set('key3', 'value3');
      expect(lruCache.size).toBe(3);

      lruCache.set('key4', 'value4'); // Should evict key1
      expect(lruCache.size).toBe(3);
    });

    it('should provide cache statistics', () => {
      const stats1 = lruCache.getStats();
      expect(stats1.size).toBe(0);
      expect(stats1.maxSize).toBe(3);
      expect(stats1.utilization).toBe(0);

      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');

      const stats2 = lruCache.getStats();
      expect(stats2.size).toBe(2);
      expect(stats2.maxSize).toBe(3);
      expect(stats2.utilization).toBeCloseTo(66.67, 1); // 2/3 * 100

      lruCache.set('key3', 'value3');

      const stats3 = lruCache.getStats();
      expect(stats3.size).toBe(3);
      expect(stats3.maxSize).toBe(3);
      expect(stats3.utilization).toBe(100);
    });

    it('should handle unlimited cache in stats', () => {
      const unlimitedCache = new Cache<string>(1000, 0);
      unlimitedCache.set('key1', 'value1');
      unlimitedCache.set('key2', 'value2');

      const stats = unlimitedCache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(0);
      expect(stats.utilization).toBe(0); // No limit, so 0% utilization
    });
  });
});
