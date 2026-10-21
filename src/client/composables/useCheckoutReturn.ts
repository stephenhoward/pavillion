import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FundingService from '@/client/service/funding';
import { CHECKOUT_SESSION_ID_PATTERN } from '@/common/model/funding-plan';

/**
 * What a verified checkout session means for the page: the plan started, or it
 * did not. A session that is still open has no outcome yet.
 */
export type CheckoutOutcome = 'success' | 'error';

/**
 * Ask the server what became of a checkout session.
 *
 * The one reading of a session's status, shared by the embedded checkout's
 * completion callback (FundingForm) and the redirect return below. The server
 * records the plan when it sees a complete session, so this call is also what
 * starts the plan if the webhook has not arrived yet.
 *
 * @param {FundingService} service - The service to ask
 * @param {string} sessionId - A Stripe Checkout Session id
 * @returns {Promise<CheckoutOutcome | null>} The outcome, or null while the
 *   session is still open. A failed lookup is reported as an error.
 */
export async function verifyCheckoutSession(
  service: FundingService,
  sessionId: string,
): Promise<CheckoutOutcome | null> {
  try {
    const { status } = await service.getCheckoutSessionStatus(sessionId);
    if (status === 'complete') {
      return 'success';
    }
    if (status === 'expired') {
      return 'error';
    }
    return null;
  }
  catch {
    return 'error';
  }
}

/**
 * Confirm a checkout that returned to this page by redirect.
 *
 * Most payment methods complete inside the embedded checkout and never leave
 * the page. A redirect-based one sends the browser to the provider and back to
 * the return URL with `?session_id=`, by which time the sheet that started the
 * checkout is gone — so the page the return URL addresses has to confirm it.
 *
 * On mount, `session_id` is stripped with `router.replace` before anything is
 * asked of the server, so a reload or a back navigation never confirms twice.
 * A value that is not a Checkout Session id (Stripe's own unsubstituted
 * `{CHECKOUT_SESSION_ID}` template among them) is dropped without a request.
 *
 * @param {(outcome: CheckoutOutcome) => void | Promise<void>} onOutcome -
 *   Called once with the outcome of a verified session; not called when there
 *   was nothing to verify or the session is still open.
 */
export function useCheckoutReturn(
  onOutcome: (outcome: CheckoutOutcome) => void | Promise<void>,
) {
  const route = useRoute();
  const router = useRouter();

  onMounted(async () => {
    if (!('session_id' in route.query)) {
      return;
    }

    const { session_id: sessionId, ...query } = route.query;
    await router.replace({ path: route.path, query, hash: route.hash });

    if (typeof sessionId !== 'string' || !CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
      return;
    }

    const outcome = await verifyCheckoutSession(new FundingService(), sessionId);
    if (outcome) {
      await onOutcome(outcome);
    }
  });
}
