/**
 * Regenerates x-props-allowlist.vevent.json from x-props-allowlist.ics by
 * running the ICS through node-ical's real `sync.parseICS()`.
 *
 * Run after any node-ical upgrade, or after editing the .ics:
 *
 *     npx tsx src/server/calendar/test/service/import/fixtures/capture-x-props-fixture.ts
 *
 * The capture exists because node-ical cannot be loaded inside the vitest
 * vmThreads pool: it `require`s temporal-polyfill, and Node's `module-sync`
 * export condition resolves that require to the package's ESM entry, which
 * the vm sandbox cannot evaluate (inlining via `server.deps.inline` does not
 * reach a native CJS require). Outside vitest the parser loads normally.
 *
 * Dates are written as `{ "$date": iso, "tz": tz }` because node-ical stamps
 * a non-enumerable `tz` onto each Date, which plain JSON would drop. The
 * consuming test revives them with the same encoding.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ical from 'node-ical';

const icsPath = fileURLToPath(new URL('./x-props-allowlist.ics', import.meta.url));
const jsonPath = fileURLToPath(new URL('./x-props-allowlist.vevent.json', import.meta.url));

const parsed = ical.sync.parseICS(readFileSync(icsPath, 'utf8'));
const vevents = Object.values(parsed).filter((component) => component?.type === 'VEVENT');
if (vevents.length !== 1) {
  throw new Error(`expected exactly one VEVENT in ${icsPath}, found ${vevents.length}`);
}

const json = JSON.stringify(
  vevents[0],
  function (this: Record<string, unknown>, key: string, value: unknown) {
    const original = this[key];
    if (original instanceof Date) {
      return { $date: original.toISOString(), tz: (original as Date & { tz?: string }).tz };
    }
    return value;
  },
  2,
);

writeFileSync(jsonPath, `${json}\n`);
console.log(`wrote ${jsonPath}`);
