import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStripeCheckout } from '@/client/composables/useStripeCheckout';

describe('useStripeCheckout', () => {
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

  it('should return loading, error, and stripe refs', () => {
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    const { stripe, loading, error } = useStripeCheckout('pk_test_123');

    expect(loading).toBeDefined();
    expect(error).toBeDefined();
    expect(stripe).toBeDefined();
  });

  it('should use existing window.Stripe if already loaded', () => {
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    const { stripe, loading, error } = useStripeCheckout('pk_test_123');

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_123');
    expect(stripe.value).toStrictEqual(mockStripeInstance);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it('should dynamically load Stripe.js when not present', async () => {
    simulateStripeLoad();

    const { stripe, loading, error } = useStripeCheckout('pk_test_456');

    // Initially loading
    expect(loading.value).toBe(true);

    // Wait for async script load
    await new Promise(resolve => setTimeout(resolve, 10));

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_456');
    expect(stripe.value).toStrictEqual(mockStripeInstance);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it('should set error when script fails to load', async () => {
    simulateStripeLoadError();

    const { stripe, loading, error } = useStripeCheckout('pk_test_789');

    expect(loading.value).toBe(true);

    // Wait for async error
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(stripe.value).toBeNull();
    expect(loading.value).toBe(false);
    expect(error.value).toBe('Failed to load Stripe.js');
  });

  it('should set error when window.Stripe is not available after script loads', async () => {
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

    const { stripe, loading, error } = useStripeCheckout('pk_test_no_stripe');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(stripe.value).toBeNull();
    expect(loading.value).toBe(false);
    expect(error.value).toBe('Stripe.js loaded but Stripe is not available');
  });

  it('should not add duplicate script tags', () => {
    // Add a pre-existing stripe script tag
    const existingScript = originalCreateElement('script');
    existingScript.src = 'https://js.stripe.com/v3/';
    document.head.appendChild(existingScript);

    // Stripe is available
    (window as any).Stripe = vi.fn().mockReturnValue(mockStripeInstance);

    useStripeCheckout('pk_test_dup');

    const stripeScripts = document.querySelectorAll('script[src="https://js.stripe.com/v3/"]');
    expect(stripeScripts.length).toBe(1);
  });
});
