import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `page_url` to `calendar_actor` — the public page URL a remote peer
 * declares in its own actor document (`url`).
 *
 * A peer's public page URL is not ours to construct. Before this column we
 * templated our own route shape onto the peer's host, which DEC-018 made
 * version-dependent: the shape that works on an upgraded peer does not work on
 * one that has not upgraded. Caching what the peer itself declares removes the
 * guess.
 *
 * Nullable with no backfill. The value is written **once, at follow time** —
 * `followCalendar` is the only path that fetches a peer's actor document — and
 * there is no refresher: `isMetadataStale` has no caller outside
 * `remote_calendar.ts` itself, so nothing re-reads a peer's `url` on a
 * schedule. A row created by an inbound activity (which never fetches the
 * document) therefore keeps `page_url = NULL` indefinitely, and the display
 * path falls back to the legacy `/view/{urlName}` spelling, which resolves on
 * peers of either version. Backfilling would need one outbound fetch per peer
 * to replace a link that already works.
 *
 * This is a **display snapshot** in the DEC-015 sense: staleness is tolerable,
 * not a defect, and nothing may gate authorization, trust, or routing on it.
 * The value is peer-supplied text rendered as an anchor href on anonymous
 * public pages, so it is scheme-allowlisted and host-pinned to the actor URI's
 * host by `sanitizePeerPageUrl` before it is ever written here.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'calendar_actor', 'page_url', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'calendar_actor', 'page_url');
  },
};
