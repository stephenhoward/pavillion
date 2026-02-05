/**
 * A simple in-memory cache with expiration and LRU eviction
 */
export class Cache<T> {
  private cache: Map<string, { value: T, expiry: number }> = new Map();
  private defaultTtl: number;
  private maxSize: number;

  /**
   * Create a new cache
   * @param defaultTtlMs Default time-to-live in milliseconds
   * @param maxSize Maximum number of items in cache (0 = unlimited)
   */
  constructor(defaultTtlMs: number = 3600000, maxSize: number = 0) { // Default 1 hour, unlimited size
    this.defaultTtl = defaultTtlMs;
    this.maxSize = maxSize;
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to store
   * @param ttlMs Optional custom TTL in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    const expiry = Date.now() + (ttlMs || this.defaultTtl);

    // If key already exists, delete it first to maintain insertion order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add the new entry
    this.cache.set(key, { value, expiry });

    // Evict oldest entries if we exceeded max size
    if (this.maxSize > 0 && this.cache.size > this.maxSize) {
      this.evictOldest();
    }
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or undefined if not found or expired
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);

    // Return undefined if item doesn't exist or is expired
    if (!item || item.expiry < Date.now()) {
      if (item) {
        this.cache.delete(key); // Clean up expired item
      }
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  /**
   * Remove an item from the cache
   * @param key The cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics for monitoring
   * @returns Object with cache size, max size, and utilization percentage
   */
  getStats(): { size: number; maxSize: number; utilization: number } {
    const utilization = this.maxSize > 0 ? (this.cache.size / this.maxSize) * 100 : 0;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: Math.round(utilization * 100) / 100, // Round to 2 decimal places
    };
  }

  /**
   * Evict the oldest (least recently used) entries to maintain max size
   */
  private evictOldest(): void {
    // Map keys are in insertion order, so the first key is the oldest
    const entriesToRemove = this.cache.size - this.maxSize;
    const keysToRemove: string[] = [];

    let count = 0;
    for (const key of this.cache.keys()) {
      if (count >= entriesToRemove) {
        break;
      }
      keysToRemove.push(key);
      count++;
    }

    for (const key of keysToRemove) {
      this.cache.delete(key);
    }
  }
}
