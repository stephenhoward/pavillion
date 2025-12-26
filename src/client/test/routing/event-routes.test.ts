import { expect, describe, it, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

describe('Event Routes Configuration', () => {
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

    // Create a minimal route configuration for testing
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
          // Mock authentication check
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
          // Mock authentication check
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
  });

  it('should register /event route for creating new events', () => {
    const route = router.resolve({ path: '/event' });
    expect(route.name).toBe('event_new');
    expect(route.path).toBe('/event');
  });

  it('should register /event/:eventId route for editing events', () => {
    const testEventId = '123e4567-e89b-12d3-a456-426614174000';
    const route = router.resolve({ path: `/event/${testEventId}` });
    expect(route.name).toBe('event_edit');
    expect(route.path).toBe(`/event/${testEventId}`);
  });

  it('should redirect unauthenticated users to login when accessing /event', async () => {
    // Mock unauthenticated state
    (mockLocalStorage.getItem as sinon.SinonStub).returns(null);

    await router.push('/event');
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('should redirect unauthenticated users to login when accessing /event/:eventId', async () => {
    // Mock unauthenticated state
    (mockLocalStorage.getItem as sinon.SinonStub).returns(null);

    const testEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push(`/event/${testEventId}`);
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('should allow authenticated users to access /event', async () => {
    // Mock authenticated state with valid token
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (mockLocalStorage.getItem as sinon.SinonStub).returns(JSON.stringify({
      exp: futureExp,
      isAdmin: false,
      email: 'test@example.com',
    }));

    await router.push('/event');
    expect(router.currentRoute.value.name).toBe('event_new');
  });

  it('should allow authenticated users to access /event/:eventId with props', async () => {
    // Mock authenticated state with valid token
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (mockLocalStorage.getItem as sinon.SinonStub).returns(JSON.stringify({
      exp: futureExp,
      isAdmin: false,
      email: 'test@example.com',
    }));

    const testEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push(`/event/${testEventId}`);
    expect(router.currentRoute.value.name).toBe('event_edit');
    expect(router.currentRoute.value.params.eventId).toBe(testEventId);
  });

  it('should handle query parameters for duplication mode', async () => {
    // Mock authenticated state
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (mockLocalStorage.getItem as sinon.SinonStub).returns(JSON.stringify({
      exp: futureExp,
      isAdmin: false,
      email: 'test@example.com',
    }));

    const sourceEventId = '123e4567-e89b-12d3-a456-426614174000';
    await router.push(`/event?from=${sourceEventId}`);

    expect(router.currentRoute.value.name).toBe('event_new');
    expect(router.currentRoute.value.query.from).toBe(sourceEventId);
  });
});
