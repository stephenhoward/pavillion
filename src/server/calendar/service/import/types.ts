/**
 * Shared dependency-injection types for the ICS import service cluster
 * (Fetcher, DnsVerifier, ...). Keeping these in one place avoids duplicate
 * declarations drifting apart across the import modules.
 */

/** URL SSRF validator (scheme + IP-literal private check). */
export type UrlValidatorFn = (url: string) => Promise<boolean>;
