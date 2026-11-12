import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const localesDir = path.join(path.resolve(), 'src/server/locales');
const load = (lng: string, ns: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(localesDir, lng, `${ns}.json`), 'utf8'));
const placeholders = (value: string) => [...value.matchAll(/{{\s*([\w.]+)\s*}}/g)].map(m => m[1]).sort();

describe.each(['account_invitation_email', 'editor_invitation_email'])('%s locale parity', (ns) => {
  const en = load('en', ns);

  it.each(['es', 'fr'])('%s has the same keys and placeholders as en', (lng) => {
    const other = load(lng, ns);

    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(placeholders(other[key]), `${lng}.${key}`).toEqual(placeholders(en[key]));
    }
  });
});
