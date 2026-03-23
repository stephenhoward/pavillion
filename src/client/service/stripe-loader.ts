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
export async function loadStripe(publishableKey: string): Promise<any> {
  // If Stripe is already loaded globally, initialize immediately
  if ((window as any).Stripe) {
    return (window as any).Stripe(publishableKey);
  }

  // Load the Stripe.js script
  await loadStripeScript();

  const Stripe = (window as any).Stripe;
  if (!Stripe) {
    throw new Error('Stripe.js loaded but Stripe is not available');
  }

  return Stripe(publishableKey);
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
      if ((window as any).Stripe) {
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
