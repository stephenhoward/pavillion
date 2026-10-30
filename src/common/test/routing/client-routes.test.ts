import { describe, it, expect } from 'vitest';

import { topLevelSegmentsOf } from './client-routes';

/**
 * The reader behind the client-router tripwire in reserved-segments.test.ts,
 * exercised on inline fixtures. Each case is a shape that a character-level
 * scan got wrong, or that a reformat of src/client/routes.ts could produce.
 */
describe('topLevelSegmentsOf', () => {
  const read = (body: string) => topLevelSegmentsOf(
    `export function build() {\n  const routes: RouteRecordRaw[] = [\n${body}\n  ];\n  return routes;\n}\n`,
  );

  it('reads top-level paths and the children of the root route', () => {
    const scan = read(`
      { path: '/', component: A,
        children: [
          { path: 'inbox', component: B },
          { path: 'settings', component: C,
            children: [{ path: 'nested', component: D }] },
        ],
      },
      { path: '/auth', component: E, children: [{ path: 'login', component: F }] },
      { path: '/event/:eventId', component: G },
    `);

    expect(scan).toEqual({ segments: ['inbox', 'settings', 'auth', 'event'], unparseable: [] });
  });

  it('does not drop a top-level route that follows a comment containing braces', () => {
    const scan = read(`
      // A { stray } brace in a comment, and an unbalanced one: {
      { path: '/one', component: A },
      /* } */
      { path: '/two', component: B, meta: { note: '{ not a brace }' } },
    `);

    expect(scan.segments).toEqual(['one', 'two']);
  });

  it('reads the root route\'s children when children are declared before path', () => {
    const scan = read(`
      { children: [{ path: 'inbox', component: B }], component: A, path: '/' },
      { path: '/auth', component: E },
    `);

    expect(scan.segments).toEqual(['inbox', 'auth']);
  });

  it('reports a template-literal path as unparseable', () => {
    const scan = read('      { path: `/${prefix}`, component: A },');

    expect(scan.segments).toEqual([]);
    expect(scan.unparseable).toHaveLength(1);
    expect(scan.unparseable[0]).toContain('`/${prefix}`');
  });

  it('reports a spread element and a route without a literal path as unparseable', () => {
    const scan = read(`
      ...extraRoutes,
      { ...baseRoute },
      { path: computedPath, component: A },
    `);

    expect(scan.segments).toEqual([]);
    expect(scan.unparseable).toHaveLength(3);
  });

  it('gives identical output for a reindented, one-lined table', () => {
    const multiLine = read(`
      {
        path: '/',
        component: A,
        children: [
          {
            path: 'inbox',
            component: B,
          },
        ],
      },
      {
        path: "/auth",
        component: E,
      },
    `);
    const oneLine = read(`{ path: '/', component: A, children: [{ path: 'inbox', component: B }] }, { path: '/auth', component: E }`);

    expect(oneLine).toEqual(multiLine);
    expect(oneLine.segments).toEqual(['inbox', 'auth']);
  });

  it('throws when the routes array is no longer declared', () => {
    expect(() => topLevelSegmentsOf('export const table = [];')).toThrow(/routes/);
  });
});
