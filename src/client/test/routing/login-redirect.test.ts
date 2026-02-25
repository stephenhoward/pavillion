import { expect, describe, it, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

describe('Login Redirect Route', () => {
  let router: Router;

  beforeEach(() => {
    const routes: RouteRecordRaw[] = [
      {
        path: '/auth',
        component: {},
        children: [
          {
            path: 'login',
            component: {},
            name: 'login',
          },
        ],
      },
      // Convenience redirect matching the production route
      { path: '/login', redirect: '/auth/login' },
    ];

    router = createRouter({
      history: createMemoryHistory(),
      routes,
    });
  });

  it('should redirect /login to /auth/login', async () => {
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('should resolve /login to the login named route', async () => {
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('login');
  });
});
