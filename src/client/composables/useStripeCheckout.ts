import { ref, type Ref } from 'vue';

const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

/**
 * Dynamically loads Stripe.js from the CDN and initializes it with the
 * provided publishable key. Returns reactive refs for the Stripe instance,
 * loading state, and any error that occurred.
 *
 * If Stripe.js is already present on the page (window.Stripe exists),
 * it will be reused without injecting a duplicate script tag.
 *
 * @param publishableKey - Stripe publishable key from the options API
 * @returns Reactive refs for stripe instance, loading state, and error
 */
export function useStripeCheckout(publishableKey: string): {
  stripe: Ref<any | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
} {
  const stripe = ref<any | null>(null);
  const loading = ref<boolean>(true);
  const error = ref<string | null>(null);

  /**
   * Initialize Stripe with the publishable key.
   */
  function initStripe(): void {
    const Stripe = (window as any).Stripe;
    if (!Stripe) {
      error.value = 'Stripe.js loaded but Stripe is not available';
      loading.value = false;
      return;
    }
    stripe.value = Stripe(publishableKey);
    loading.value = false;
  }

  /**
   * Load Stripe.js by injecting a script tag into the document head.
   */
  function loadStripeScript(): void {
    // Check if script tag already exists
    const existingScript = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    if (existingScript) {
      // Script tag exists but Stripe isn't available yet; wait or init
      if ((window as any).Stripe) {
        initStripe();
      }
      else {
        existingScript.addEventListener('load', () => initStripe());
        existingScript.addEventListener('error', () => {
          error.value = 'Failed to load Stripe.js';
          loading.value = false;
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = STRIPE_JS_URL;
    script.onload = () => initStripe();
    script.onerror = () => {
      error.value = 'Failed to load Stripe.js';
      loading.value = false;
    };
    document.head.appendChild(script);
  }

  // If Stripe is already loaded globally, initialize immediately
  if ((window as any).Stripe) {
    initStripe();
  }
  else {
    loadStripeScript();
  }

  return { stripe, loading, error };
}
