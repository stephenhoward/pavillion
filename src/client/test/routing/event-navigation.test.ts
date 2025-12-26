import { expect, describe, it, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

describe('Event Route Navigation', () => {
  let router: Router;
  let mockLocalStorage: Storage;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock localStorage for authentication
    mockLocalStorage = {
      getItem: sandbox.stub(),
      setItem: sandbox.stub(),
      removeItem: sandbox.stub(),
      clear: sandbox.stub(),
      key: sandbox.stub(),
      length: 0,
    } as Storage;

    // Create route configuration matching the main app
    const routes: RouteRecordRaw[] = [
      {
        path: '/auth/login',
        component: {},
        name: 'login',
      },
      {
        path: '/event',
        component: {},
        name: 'event_new',
        beforeEnter: (to, from, next) => {
          const token = mockLocalStorage.getItem('jw_token');
          if (token) {
            const claims = JSON.parse(token);
            if (claims.exp > Math.floor(Date.now() / 1000)) {
              next();
              return;
            }
          }
          next({ name: 'login' });
        },
      },
      {
        path: '/event/:eventId',
        component: {},
        name: 'event_edit',
        props: true,
        beforeEnter: (to, from, next) => {
          const token = mockLocalStorage.getItem('jw_token');
          if (token) {
            const claims = JSON.parse(token);
            if (claims.exp > Math.floor(Date.now() / 1000)) {
              next();
              return;
            }
          }
          next({ name: 'login' });
        },
      },
    ];

    router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    // Mock authenticated state by default
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (mockLocalStorage.getItem as sinon.SinonStub).returns(JSON.stringify({
      exp: futureExp,
      isAdmin: false,
      email: 'test@example.com',
    }));
  });

  it('should navigate programmatically to /event for new event creation', async () => {
    await router.push('/event');

    expect(router.currentRoute.value.name).toBe('event_new');
    expect(router.currentRoute.value.path).toBe('/event');
  });

  it('should navigate programmatically to /event/:eventId for editing', async () => {
    const testEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push(`/event/${testEventId}`);

    expect(router.currentRoute.value.name).toBe('event_edit');
    expect(router.currentRoute.value.path).toBe(`/event/${testEventId}`);
    expect(router.currentRoute.value.params.eventId).toBe(testEventId);
  });

  it('should navigate to /event with query parameter for duplication', async () => {
    const sourceEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push({ path: '/event', query: { from: sourceEventId } });

    expect(router.currentRoute.value.name).toBe('event_new');
    expect(router.currentRoute.value.path).toBe('/event');
    expect(router.currentRoute.value.query.from).toBe(sourceEventId);
  });

  it('should support navigation using route name for new event', async () => {
    await router.push({ name: 'event_new' });

    expect(router.currentRoute.value.name).toBe('event_new');
    expect(router.currentRoute.value.path).toBe('/event');
  });

  it('should support navigation using route name for edit event', async () => {
    const testEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push({ name: 'event_edit', params: { eventId: testEventId } });

    expect(router.currentRoute.value.name).toBe('event_edit');
    expect(router.currentRoute.value.params.eventId).toBe(testEventId);
  });

  it('should support navigation with both route name and query parameters', async () => {
    const sourceEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push({
      name: 'event_new',
      query: { from: sourceEventId },
    });

    expect(router.currentRoute.value.name).toBe('event_new');
    expect(router.currentRoute.value.query.from).toBe(sourceEventId);
  });
});
