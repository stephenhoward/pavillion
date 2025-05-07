/**
 * A simple in-memory cache with expiration
 */
export class Cache<T> {
  private cache: Map<string, { value: T, expiry: number }> = new Map();
  private defaultTtl: number;

  /**
     * Create a new cache
     * @param defaultTtlMs Default time-to-live in milliseconds
     */
  constructor(defaultTtlMs: number = 3600000) { // Default 1 hour
    this.defaultTtl = defaultTtlMs;
  }

  /**
     * Set a value in the cache
     * @param key The cache key
     * @param value The value to store
     * @param ttlMs Optional custom TTL in milliseconds
     */
  set(key: string, value: T, ttlMs?: number): void {
    const expiry = Date.now() + (ttlMs || this.defaultTtl);
    this.cache.set(key, { value, expiry });
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
}
