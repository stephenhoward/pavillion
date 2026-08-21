import type { Stripe, StripeConstructor } from '@stripe/stripe-js';

const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

/**
 * Dynamically loads Stripe.js from the CDN and initializes it with the
 * provided publishable key. Returns a Promise that resolves to the
 * Stripe instance.
 *
 * If Stripe.js is already present on the page (window.Stripe exists),
 * it will be reused without injecting a duplicate script tag.
 *
 * @param publishableKey - Stripe publishable key from the options API
 * @returns Promise resolving to the initialized Stripe instance
 */
export async function loadStripe(publishableKey: string): Promise<Stripe> {
  // If Stripe is already loaded globally, initialize immediately
  if (window.Stripe) {
    return window.Stripe(publishableKey);
  }

  // Load the Stripe.js script
  await loadStripeScript();

  const stripeConstructor = getStripeGlobal();
  if (!stripeConstructor) {
    throw new Error('Stripe.js loaded but Stripe is not available');
  }

  return stripeConstructor(publishableKey);
}

/**
 * Read window.Stripe without control-flow narrowing. Inside loadStripe, TS
 * narrows window.Stripe to undefined after the early-return branch and does
 * not reset that narrowing across the script-loading call, so a direct read
 * there would be typed as always-undefined.
 */
function getStripeGlobal(): StripeConstructor | undefined {
  return window.Stripe;
}

/**
 * Load Stripe.js by injecting a script tag into the document head.
 * Returns a Promise that resolves when the script is loaded.
 */
function loadStripeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if script tag already exists
    const existingScript = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    if (existingScript) {
      // Script tag exists but Stripe isn't available yet; wait for it
      if (window.Stripe) {
        resolve();
      }
      else {
        existingScript.addEventListener('load', () => resolve());
        existingScript.addEventListener('error', () => {
          reject(new Error('Failed to load Stripe.js'));
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = STRIPE_JS_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      reject(new Error('Failed to load Stripe.js'));
    };
    document.head.appendChild(script);
  });
}
