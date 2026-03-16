import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadStripe } from '@/client/service/stripe-loader';

describe('loadStripe', () => {
  let mockStripeInstance: any;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    mockStripeInstance = {
      initEmbeddedCheckout: vi.fn(),
      elements: vi.fn(),
    };

    // Clean up any previous Stripe global
    delete (window as any).Stripe;

    // Store original createElement
    originalCreateElement = document.createElement.bind(document);
  });

  afterEach(() => {
    // Restore createElement
    document.createElement = originalCreateElement;

    // Clean up Stripe global
    delete (window as any).Stripe;

    // Remove any injected script tags
    const scripts = document.querySelectorAll('script[src*="stripe"]');
    scripts.forEach(s => s.remove());

    vi.restoreAllMocks();
  });

  /**
   * Helper to simulate Stripe.js loading by setting window.Stripe
   * after the script's onload fires.
   */
  function simulateStripeLoad() {
    const realCreate = originalCreateElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = realCreate(tagName);
      if (tagName === 'script') {
        vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
          (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);
          // Fire onload asynchronously
          setTimeout(() => {
            (el as HTMLScriptElement).onload?.(new Event('load'));
          }, 0);
          return node;
        });
      }
      return el;
    });
  }

  function simulateStripeLoadError() {
    const realCreate = originalCreateElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = realCreate(tagName);
      if (tagName === 'script') {
        vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
          setTimeout(() => {
            (el as HTMLScriptElement).onerror?.(new Event('error'));
          }, 0);
          return node;
        });
      }
      return el;
    });
  }

  it('should return a Stripe instance', async () => {
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    const result = await loadStripe('pk_test_123');

    expect(result).toStrictEqual(mockStripeInstance);
  });

  it('should use existing window.Stripe if already loaded', async () => {
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    const result = await loadStripe('pk_test_123');

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_123');
    expect(result).toStrictEqual(mockStripeInstance);
  });

  it('should dynamically load Stripe.js when not present', async () => {
    simulateStripeLoad();

    const result = await loadStripe('pk_test_456');

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_456');
    expect(result).toStrictEqual(mockStripeInstance);
  });

  it('should reject when script fails to load', async () => {
    simulateStripeLoadError();

    await expect(loadStripe('pk_test_789')).rejects.toThrow('Failed to load Stripe.js');
  });

  it('should reject when window.Stripe is not available after script loads', async () => {
    const realCreate = originalCreateElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = realCreate(tagName);
      if (tagName === 'script') {
        vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
          // Script loads but window.Stripe is NOT set
          setTimeout(() => {
            (el as HTMLScriptElement).onload?.(new Event('load'));
          }, 0);
          return node;
        });
      }
      return el;
    });

    await expect(loadStripe('pk_test_no_stripe')).rejects.toThrow(
      'Stripe.js loaded but Stripe is not available',
    );
  });

  it('should not add duplicate script tags', async () => {
    // Add a pre-existing stripe script tag
    const existingScript = originalCreateElement('script');
    existingScript.src = 'https://js.stripe.com/v3/';
    document.head.appendChild(existingScript);

    // Stripe is available
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    await loadStripe('pk_test_dup');

    const stripeScripts = document.querySelectorAll('script[src="https://js.stripe.com/v3/"]');
    expect(stripeScripts.length).toBe(1);
  });
});
