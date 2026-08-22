# Federation e2e specs

These specs run against the Docker federation environment (`docker-compose.federation.yml`,
started with `npm run federation:start`). See `docs/federation-testing.md` for setup.

## Why specs do not tear down the calendars and events they create

Specs create calendars, events, accounts and follows through the API helpers and
never delete them in an `afterAll` hook. That is deliberate:

- Both web instances (`instance_alpha`, `instance_beta`) run with `NODE_ENV=federation`
  and `DB_RESET=true`. On every container start, `initializeDatabase()` in
  `src/server/server.ts` runs `db.sync({ force: true })` and re-seeds, so each
  fresh start of the environment begins from an empty, seeded database. The worker
  containers run with `DB_RESET=false` so they do not race that reset.
- Every spec names its calendars with a unique prefix (`generateCalendarName`), so data
  left behind by one run cannot collide with the next.

Re-running `npm run test:federation` while the containers stay up does accumulate test
rows inside that container lifetime; this is harmless for the assertions the specs make.
To get a clean database, restart the instances, or run `npm run federation:reset` to also
drop the named volumes.

Do not add per-spec teardown unless this reset behaviour changes.
