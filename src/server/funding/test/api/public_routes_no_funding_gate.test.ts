import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { EventEmitter } from 'events';

import PublicCalendarAPI from '@/server/public/api/v1';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';
import { isFundingAccessGate, requireFundingAccess } from '@/server/funding/api/middleware';

/**
 * DEC-004 invariant: anonymous access to public event and calendar
 * information is never funding-gated.
 *
 * Full anonymous access to public event information is a product commitment,
 * not an implementation detail — a visitor reading a community's calendar is
 * not a customer and cannot be asked to pay, nor can their view of a
 * community be withheld because that community stopped paying us. This suite
 * asserts the shape of the public router tree rather than the behaviour of
 * one endpoint, so it keeps holding as endpoints are added to it.
 *
 * The mechanical check is possible because requireFundingAccess tags every
 * gate it builds; see isFundingAccessGate.
 *
 * Scope note: this is about the public API (`/api/public/v1`), the surface
 * that serves the anonymous `/view/` site. The widget API is a different
 * surface — DEC-011 classes embedding a calendar into a non-federated web
 * property as an outbound platform bridge, so the widget's existing 402 to an
 * anonymous embedder is deliberate and stays as it is.
 */
describe('DEC-004: the public router tree carries no funding gate', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    const calendarInterface = new CalendarInterface(new EventEmitter());
    const publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    PublicCalendarAPI.install(app, publicInterface);
  });

  /**
   * Walks an Express application's layer tree and returns every registered
   * handler, flattening nested routers and per-route handler chains.
   */
  function allHandlers(application: express.Application): unknown[] {
    const handlers: unknown[] = [];

    const walk = (layers: any[]): void => {
      for (const layer of layers ?? []) {
        if (layer.route) {
          walk(layer.route.stack);
        }
        else if (layer.handle?.stack) {
          walk(layer.handle.stack);
        }
        else {
          handlers.push(layer.handle);
        }
      }
    };

    walk((application as any)._router?.stack);

    return handlers;
  }

  it('should find a gate mounted the same way the public routes are', () => {
    // Negative control. Without it this suite would keep passing if the walk
    // stopped descending into routers, or if the tag were dropped — it would
    // be asserting that it found nothing, having looked nowhere.
    const gatedApp = express();
    const router = express.Router();
    router.get(
      '/calendar/:calendarId',
      requireFundingAccess({} as any, 'widget_embedding'),
      (_req, res) => res.json({}),
    );
    gatedApp.use('/api/public/v1', router);

    expect(allHandlers(gatedApp).filter(isFundingAccessGate)).toHaveLength(1);
  });

  it('should carry no funding gate on any public route', () => {
    const gated = allHandlers(app).filter(isFundingAccessGate);

    expect(gated.map((gate) => gate.fundingGatedFeature)).toEqual([]);
    // The public tree really was walked, not skipped.
    expect(allHandlers(app).length).toBeGreaterThan(0);
  });
});
