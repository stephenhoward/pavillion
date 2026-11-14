/**
 * Domain-boundary guard for src/server (DEC-003: domains cannot directly
 * import from other domains). A domain's other domains are reachable only
 * through `interface/` and `events/types*`.
 */

// DEC-003 violators that predate this guard. Entries are removed and never
// added; removing one is a one-line PR. Fix the import, then delete the entry.
const KNOWN_VIOLATORS = [
  '^src/server/accounts/service/account\\.ts$',
  '^src/server/calendar/service/calendar\\.ts$',
  '^src/server/calendar/service/series\\.ts$',
  '^src/server/calendar/service/event_instance\\.ts$',
  '^src/server/calendar/service/events\\.ts$',
  '^src/server/calendar/service/category_mapping\\.ts$',
];

// Directories under src/server that are not domains.
const FROM_DOMAIN = '^src/server/(?!(?:common|cli|test|locales|templates)/)([^/]+)/';

// Composition roots, scripts and tests may reach across domains.
const EXEMPT_FROM = [
  '^src/server/(server|worker|app)\\.ts$',
  '^src/server/[^/]+/scripts/',
  '/test/',
  '\\.test\\.ts$',
  '^src/server/test/',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-domain-internals',
      comment: 'DEC-003: import another domain only through its interface/ or events/types*.',
      severity: 'error',
      from: {
        path: FROM_DOMAIN,
        pathNot: [...KNOWN_VIOLATORS, ...EXEMPT_FROM, '/entity/'],
      },
      to: {
        path: '^src/server/(?!common/)[^/]+/(service|model|api|entity)/',
        pathNot: '^src/server/$1/',
      },
    },
    {
      name: 'no-cross-domain-internals-from-entity',
      comment: 'DEC-003: an entity may not import the service, model or api of another domain; entity to entity is the warn rule.',
      severity: 'error',
      from: {
        path: '^src/server/(?!(?:common|cli|test|locales|templates)/)([^/]+)/entity/',
        pathNot: EXEMPT_FROM,
      },
      to: {
        path: '^src/server/(?!common/)[^/]+/(service|model|api)/',
        pathNot: '^src/server/$1/',
      },
    },
    {
      name: 'no-cross-domain-entity-to-entity',
      comment: 'Sequelize associations link entities across domains; counted, not blocked.',
      severity: 'warn',
      from: {
        path: '^src/server/(?!(?:common|cli|test|locales|templates)/)([^/]+)/entity/',
        pathNot: EXEMPT_FROM,
      },
      to: {
        path: '^src/server/(?!common/)[^/]+/entity/',
        pathNot: '^src/server/$1/',
      },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'An unresolved import evades every other rule.',
      severity: 'error',
      from: { path: '^src/server' },
      to: { couldNotResolve: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    includeOnly: '^src/server',
    doNotFollow: { path: 'node_modules' },
  },
};
