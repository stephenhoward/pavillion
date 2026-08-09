import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { FUNDING_GATED_FEATURES, type FundingGatedFeature } from '@/common/model/funding-plan';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import type FundingInterface from '@/server/funding/interface';

/**
 * An Express handler produced by {@link requireFundingAccess}, tagged with the
 * feature it gates.
 *
 * The tag is not decoration. "Which routes are funding-gated?" is a question
 * the product needs to be able to answer mechanically — DEC-004 commits us to
 * never gating anonymous public reads, and a commitment that can only be
 * checked by reading route files by hand is one that drifts. Tagging the
 * handler makes any router tree inspectable for gates.
 */
export interface FundingAccessGate extends RequestHandler {
  readonly fundingGatedFeature: FundingGatedFeature;
}

/**
 * Whether a value is a funding gate built by {@link requireFundingAccess}.
 *
 * @param handler - Candidate Express handler, typically pulled off a router layer
 * @returns True if the handler is a funding gate
 */
export function isFundingAccessGate(handler: unknown): handler is FundingAccessGate {
  return typeof handler === 'function'
    && typeof (handler as Partial<FundingAccessGate>).fundingGatedFeature === 'string';
}

/**
 * Build Express middleware that refuses a request unless the calendar it
 * targets may use a funding-gated feature.
 *
 * ## Composition contract
 *
 * **This is not an authorization check and never substitutes for one.** It
 * answers a funding question only. When funding is switched off on the
 * instance, {@link FundingInterface.checkFundingAccess} returns true for any
 * well-formed UUID — including calendars that do not exist and calendars the
 * caller has no business touching. Mount it strictly AFTER:
 *
 *  1. authentication (`ExpressHelper.loggedInOnly` or equivalent), and
 *  2. the route's calendar-ownership / editor-permission check, which is also
 *     what establishes that the calendar exists.
 *
 * The calendar comes from `req.params[calendarIdParam]` and from nowhere else
 * — never the body, never the query string. That is the only source the
 * ownership middleware above has already validated and authorised; a body
 * field is caller-controlled and would let a request be judged against a
 * calendar nobody checked. If the named param is absent or is not a UUID, the
 * gate treats it as a broken composition and fails the request as a server
 * error rather than guessing.
 *
 * The feature key is likewise fixed here, at route registration, as a
 * compile-time literal. Nothing about the request can influence which gate is
 * being asked about. The key is checked against the registry when the gate is
 * built, so an unregistered key fails at boot rather than per request.
 *
 * ## Responses
 *
 *  - open      -> `next()`
 *  - unfunded  -> 402 with `errorName: 'SubscriptionRequiredError'`. A
 *    documented DEC-007 legacy exception to the usual status mapping, kept
 *    because it is the wire contract the widget clients already speak. That
 *    includes an anonymous visitor loading an unfunded widget: they get the
 *    same 402 the widget routes return today. Preserved, not introduced —
 *    DEC-011 classes embedding into a non-federated web property as an
 *    outbound platform bridge, so unlike the public `/api/public/v1` surface
 *    (which DEC-004 keeps ungated for anonymous readers, always) the widget
 *    is a legitimate place for a gate to face an anonymous caller.
 *  - anything else -> 500. Critically, this includes the case where the
 *    *instance* funding settings could not be read
 *    (`FundingAccessIndeterminateError`). That denial is our outage, not the
 *    caller's unpaid bill: telling an operator whose instance never enabled
 *    funding that their community owes money would be exactly the extraction
 *    DEC-001 rejects. Indeterminate never becomes 402.
 *
 * @param fundingInterface - The funding domain's interface
 * @param feature - Key from FUNDING_GATED_FEATURES naming the gated feature
 * @param calendarIdParam - Route param holding the calendar's UUID
 * @returns Express middleware enforcing the gate
 * @throws Error at registration time if `feature` is not in the registry
 *
 * @example
 * router.post(
 *   '/calendars/:calendarId/widget/domain',
 *   ...ExpressHelper.loggedInOnly,
 *   requireCalendarOwner,
 *   requireFundingAccess(fundingInterface, 'widget_embedding'),
 *   this.setDomain.bind(this),
 * );
 */
export function requireFundingAccess(
  fundingInterface: FundingInterface,
  feature: FundingGatedFeature,
  calendarIdParam: string = 'calendarId',
): FundingAccessGate {
  if (!Object.prototype.hasOwnProperty.call(FUNDING_GATED_FEATURES, feature)) {
    throw new Error(`requireFundingAccess: '${feature}' is not a registered funding-gated feature`);
  }

  const gate = async function fundingAccessGate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const calendarId = req.params?.[calendarIdParam];

    if (typeof calendarId !== 'string' || !ExpressHelper.isValidUUID(calendarId)) {
      logError(
        new Error(`Route param '${calendarIdParam}' is absent or not a UUID`),
        `Funding gate for '${feature}' is mounted on a route that cannot supply a validated calendar`,
      );
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    let allowed: boolean;
    try {
      allowed = await fundingInterface.checkFundingAccess(calendarId, feature);
    }
    catch (error) {
      // Every throw lands here, and every throw is a 5xx. The one we must not
      // get wrong — FundingAccessIndeterminateError — is indistinguishable
      // from a genuine bug in what it licenses us to tell the caller: we do
      // not know whether they owe us anything, so we do not ask.
      logError(error, `Funding gate for '${feature}' could not determine access`);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (allowed) {
      next();
      return;
    }

    const denial = new SubscriptionRequiredError(feature);
    res.status(402).json({
      error: 'subscription_required',
      errorName: denial.name,
      message: denial.message,
      feature,
    });
  };

  return Object.assign(gate, { fundingGatedFeature: feature } as const);
}
