import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { METRICS_CONTENT_TYPE } from '@/server/housekeeping/api/metrics';
// Registers the snapshot entity with the shared Sequelize instance before
// TestEnvironment syncs the schema.
import '@/server/housekeeping/entity/disk-snapshot';

/**
 * The metrics endpoint must not be reachable on the main application
 * listener. That listener's port is published on the host by the default
 * compose deployment, so a /metrics route there would be public on every
 * instance not sitting behind a proxy that blocks it.
 *
 * This asserts the property against the fully booted application, independent
 * of the compose structure tests: those check that the port is not published,
 * this checks that there is nothing to publish on the main port in the first
 * place.
 *
 * Note the assertion is "serves no metrics", not "returns 404": the client SPA
 * catch-all answers unknown paths with the application shell by design, so a
 * status code alone would not distinguish a leak from a miss.
 */
describe('Metrics are absent from the main application listener', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('serves no OpenMetrics exposition at /metrics', async () => {
    const response = await request(env.app).get('/metrics');

    expect(response.headers['content-type']).not.toBe(METRICS_CONTENT_TYPE);
    expect(response.text ?? '').not.toContain('pavillion_backup_last_success_timestamp_seconds');
    expect(response.text ?? '').not.toContain('# EOF');
  });

  it('serves no metrics under the admin API namespace either', async () => {
    for (const path of ['/api/v1/admin/housekeeping/metrics', '/api/v1/metrics']) {
      const response = await request(env.app).get(path);

      expect(response.headers['content-type']).not.toBe(METRICS_CONTENT_TYPE);
      expect(response.text ?? '').not.toContain('pavillion_');
    }
  });
});
