/**
 * Every translation key the public surfaces ask for must exist in the bundles
 * those surfaces actually register, in every available language.
 *
 * Component tests mock translations with ad hoc local objects, so a key that
 * resolves in no real bundle passes them and renders to a visitor as the raw
 * key string. This test reads every `t()` call under src/site, src/widget and
 * src/common/ui, then asks each app's own i18next store whether the key exists
 * — per language, with fallback disabled, so a key present only in English
 * fails for Spanish and French instead of silently falling back.
 *
 * Both apps check the same file union: the widget renders site components and
 * both apps mount the shared calendar views, so a widget visitor can see any
 * key either tree asks for.
 *
 * The scan is textual and does not strip comments, so a `t('x')` written in a
 * comment is checked like a real call. Rewrite the comment if it trips.
 *
 * A call whose argument is not a string literal must be listed in
 * DYNAMIC_KEYS with every key it can produce. The table is closed: an unlisted
 * dynamic call fails, and so does an entry that no longer matches a call.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import i18next from 'i18next';

import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { URL_PROMPT_VALUES } from '@/common/model/events';
import { initI18Next as initWidgetI18Next } from '@/widget/service/locale';
import { initI18Next as initSiteI18Next } from '@/site/service/locale';

const SRC_ROOT = path.resolve(__dirname, '../../..');
const SCANNED_ROOTS = ['site', 'widget', 'common/ui'];
const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(lang => lang.code);

const BINDING_RE = /const\s*\{\s*t(?:\s*:\s*(\w+))?\s*\}\s*=\s*useTranslation\(\s*'(\w+)'\s*(?:,\s*\{\s*keyPrefix:\s*'([\w.]+)'\s*,?\s*\})?\s*\)/g;
const UNSUPPORTED_CALL_STYLE_RE = /\$t\(|i18next\.t\(|v-t=|<i18next[\s/>]/;

const RECURRENCE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(day => `recurrence.days.${day}`);
const URL_PROMPT_KEYS = URL_PROMPT_VALUES.map(value => `url_prompt.${value}`);

/**
 * Every key a non-literal `t()` argument can produce, keyed by file (relative
 * to src/) and then by the argument's source text. Keys are written before the
 * binding's keyPrefix is applied.
 */
const DYNAMIC_KEYS: Record<string, Record<string, string[]>> = {
  'common/ui/calendar-views/CalendarViewToolbar.vue': {
    'VIEW_LABEL_KEYS[view]': ['view_list', 'view_week', 'view_month'],
  },
  'site/components/category-pill-selector.vue': {
    stateKey: ['selected', 'category_absent', 'not_selected'],
  },
  'site/components/report-event.vue': {
    'option.labelKey': [
      'category_spam',
      'category_inappropriate',
      'category_misleading',
      'category_harassment',
      'category_other',
    ],
  },
  'site/components/EventDetailBody.vue': {
    '\'url_prompt.\' + safePrompt': URL_PROMPT_KEYS,
  },
  'site/components/event.vue': {
    '\'url_prompt.\' + safePrompt': URL_PROMPT_KEYS,
  },
  'site/composables/useRecurrenceText.ts': {
    '`recurrence.days.${code}`': RECURRENCE_DAYS,
    '`recurrence.days.${params.day}`': RECURRENCE_DAYS,
    '`recurrence.ordinals.${params.ordinal}`': ['1', '2', '3', '4', '-1'].map(n => `recurrence.ordinals.${n}`),
    'value.key': [
      'recurrence.every_day',
      'recurrence.every_n_days',
      'recurrence.weekly_every_week',
      'recurrence.weekly_on_days',
      'recurrence.every_n_weeks',
      'recurrence.every_n_weeks_on_days',
      'recurrence.nth_weekday_of_month',
      'recurrence.nth_weekday_every_n_months',
      'recurrence.monthly',
      'recurrence.every_n_months',
      'recurrence.yearly',
      'recurrence.every_n_years',
    ],
  },
};

interface Binding {
  name: string;
  ns: string;
  keyPrefix?: string;
}

interface KeyReference {
  file: string;
  line: number;
  ns: string;
  key: string;
}

interface DynamicCall {
  file: string;
  line: number;
  binding: Binding;
  argText: string;
}

interface Extraction {
  bindings: Binding[];
  staticRefs: KeyReference[];
  dynamicCalls: DynamicCall[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function prefixed(binding: Binding, key: string): string {
  return binding.keyPrefix ? `${binding.keyPrefix}.${key}` : key;
}

/** Reads the `useTranslation` bindings and every `t()` call made through them. */
function extract(file: string, text: string): Extraction {
  const bindings: Binding[] = [...text.matchAll(BINDING_RE)].map(match => ({
    name: match[1] ?? 't',
    ns: match[2],
    keyPrefix: match[3],
  }));

  const staticRefs: KeyReference[] = [];
  const dynamicCalls: DynamicCall[] = [];

  for (const binding of bindings) {
    const name = escapeRegExp(binding.name);
    const staticRe = new RegExp(`(?<![\\w$.])${name}\\(\\s*(['"])((?:(?!\\1).)*)\\1\\s*[,)]`, 'g');
    const anyCallRe = new RegExp(`(?<![\\w$.])${name}\\(\\s*([^,)]+)`, 'g');

    const staticStarts = new Set<number>();
    for (const match of text.matchAll(staticRe)) {
      staticStarts.add(match.index!);
      staticRefs.push({
        file,
        line: lineAt(text, match.index!),
        ns: binding.ns,
        key: prefixed(binding, match[2]),
      });
    }
    for (const match of text.matchAll(anyCallRe)) {
      if (staticStarts.has(match.index!)) {
        continue;
      }
      dynamicCalls.push({
        file,
        line: lineAt(text, match.index!),
        binding,
        argText: match[1].trim(),
      });
    }
  }

  return { bindings, staticRefs, dynamicCalls };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' ? [] : sourceFiles(entryPath);
    }
    const scanned = (entry.name.endsWith('.vue') || entry.name.endsWith('.ts'))
      && !entry.name.endsWith('.test.ts');
    return scanned ? [entryPath] : [];
  });
}

interface Scan {
  refs: KeyReference[];
  staticCallCount: number;
  problems: string[];
}

function scanSources(): Scan {
  const refs: KeyReference[] = [];
  const problems: string[] = [];
  const usedDynamicEntries = new Set<string>();
  let staticCallCount = 0;

  const files = SCANNED_ROOTS.flatMap(root => sourceFiles(path.join(SRC_ROOT, root)));
  for (const absolute of files) {
    const file = path.relative(SRC_ROOT, absolute).split(path.sep).join('/');
    const text = readFileSync(absolute, 'utf8');

    if (UNSUPPORTED_CALL_STYLE_RE.test(text)) {
      problems.push(`${file}: new call style — extend the scanner`);
    }

    const { bindings, staticRefs, dynamicCalls } = extract(file, text);
    if (text.includes('useTranslation(') && bindings.length === 0) {
      problems.push(`${file}: scanner does not understand this binding form`);
    }

    staticCallCount += staticRefs.length;
    refs.push(...staticRefs);

    for (const call of dynamicCalls) {
      const keys = DYNAMIC_KEYS[file]?.[call.argText];
      if (!keys) {
        problems.push(`${file}:${call.line} dynamic key ${call.argText} has no DYNAMIC_KEYS entry`);
        continue;
      }
      usedDynamicEntries.add(`${file}\0${call.argText}`);
      for (const key of keys) {
        refs.push({ file, line: call.line, ns: call.binding.ns, key: prefixed(call.binding, key) });
      }
    }
  }

  for (const [file, entries] of Object.entries(DYNAMIC_KEYS)) {
    for (const argText of Object.keys(entries)) {
      if (!usedDynamicEntries.has(`${file}\0${argText}`)) {
        problems.push(`${file}: stale DYNAMIC_KEYS entry ${argText} matches no call`);
      }
    }
  }

  return { refs, staticCallCount, problems };
}

function resolves(ref: KeyReference, lng: string): boolean {
  const options = { lng, ns: ref.ns, fallbackLng: false as const };
  if (i18next.exists(ref.key, options)) {
    return true;
  }
  // A plural key exists only as its suffixed forms (`_one`, `_other`).
  return i18next.exists(ref.key, { ...options, count: 1 })
    && i18next.exists(ref.key, { ...options, count: 2 });
}

describe('extractor', () => {
  const binding = 'const { t } = useTranslation(\'system\');\n';

  it('ignores calls to functions whose names end in t', () => {
    const { staticRefs, dynamicCalls } = extract('f.vue', `${binding}content('en'); format('x'); $t('x'); i18n.t('x');`);
    expect(staticRefs).toEqual([]);
    expect(dynamicCalls).toEqual([]);
  });

  it('reads an aliased binding and its namespace', () => {
    const text = 'const { t: tSystem } = useTranslation(\'ui\');\ntSystem(\'view_list\');';
    expect(extract('f.vue', text).staticRefs).toEqual([
      { file: 'f.vue', line: 2, ns: 'ui', key: 'view_list' },
    ]);
  });

  it('applies the binding keyPrefix', () => {
    const text = 'const { t } = useTranslation(\'system\', {\n  keyPrefix: \'report\',\n});\nt("title", { count });';
    expect(extract('f.vue', text).staticRefs.map(ref => ref.key)).toEqual(['report.title']);
  });

  it('reports a non-literal argument as a dynamic call', () => {
    const { staticRefs, dynamicCalls } = extract('f.vue', `${binding}t(option.labelKey)`);
    expect(staticRefs).toEqual([]);
    expect(dynamicCalls.map(call => call.argText)).toEqual(['option.labelKey']);
  });
});

describe('public translation keys', () => {
  const scan = scanSources();

  it('scans every call site', () => {
    expect(scan.problems).toEqual([]);
    expect(scan.staticCallCount).toBeGreaterThan(50);
  });

  const apps: Array<[string, () => unknown]> = [
    ['widget', () => initWidgetI18Next('en')],
    ['site', () => initSiteI18Next()],
  ];

  describe.each(apps)('%s bundles', (_app, init) => {
    beforeAll(async () => {
      await init();
    });

    it.each(LANGUAGE_CODES)('resolve every referenced key in %s', (lng) => {
      const missing = scan.refs
        .filter(ref => !resolves(ref, lng))
        .map(ref => `${ref.file}:${ref.line} ${ref.ns}:${ref.key}`);
      expect(missing).toEqual([]);
    });
  });
});
