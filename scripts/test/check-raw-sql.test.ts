import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectSource,
  detect,
  collectServerFiles,
  main,
} from '../check-raw-sql.js';

/**
 * The bulk of the suite drives the pure `detectSource(code, name)` rule with
 * inline fixtures — one per branch — so it stays fast and independent of the
 * real source tree. A separate block covers directory scanning and the CLI
 * exit-code seam, and a final isolated block is the live-scan CI safety net.
 *
 * The rule is blunt: raw SQL text must be STATIC; dynamic values belong in bind
 * parameters. Interpolation is a violation regardless of any escaping — that is
 * the point (see the "escaped interpolation is still unsafe" cases below).
 */
describe('check-raw-sql: detectSource — safe shapes (no violation)', () => {
  it('safe-static-literal: literal with a plain static string', () => {
    const code = 'db.literal(\'DATE(created_at)\');';
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-static-concat: literal of a `+` chain of only string literals', () => {
    const code = "db.literal('(SELECT MAX(x) FROM t ' + 'WHERE t.id = 1)');";
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-query-with-replacements: static SQL + { replacements } options object', () => {
    const code = [
      'db.query(`SELECT email FROM account WHERE id = :id`,',
      '  { replacements: { id }, type: QueryTypes.SELECT });',
    ].join('\n');
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-static-query: static SQL string passed to .query()', () => {
    const code = 'db.query(\'PRAGMA foreign_keys = ON;\');';
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-zod-literal: z.literal(\'Create\') is a plain string literal', () => {
    const code = 'const schema = z.object({ type: z.literal(\'Create\') });';
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-pg-object-form-static: { text, values } with static text', () => {
    const code = 'client.query({ text: \'SELECT * FROM job WHERE id = $1\', values: [id] });';
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-identifier-bound-to-static-sql: const query = static SQL; query(query, values)', () => {
    // The job-queue.ts idiom: a static, $-parameterized SQL string built in a
    // const and executed with a positional values array. One-hop resolution to
    // a static initializer keeps this safe without an annotation.
    const code = [
      'const query = `INSERT INTO pgboss.queue (name) VALUES ($1) RETURNING name;`;',
      'const result = await client.query(query, values);',
    ].join('\n');
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });
});

describe('check-raw-sql: detectSource — unsafe shapes (violation)', () => {
  it('unsafe-raw-substitution: literal interpolates an identifier', () => {
    const code = 'db.literal(`WHERE id = ${calendarId}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-escaped-substitution-inline: inline .escape() interpolation is STILL a violation', () => {
    // The rule forbids interpolation outright — escaping does not launder it.
    // The value must be bound as a replacement parameter instead.
    const code = 'db.literal(`WHERE id = ${db.escape(x)}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-escaped-substitution-identifier: escaped-bound identifier is STILL a violation', () => {
    const code = [
      'const escapedId = db.escape(calendar.id);',
      'db.literal(`WHERE id = ${escapedId}`);',
    ].join('\n');
    const violations = detectSource(code, 'bad.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it('unsafe-hoisted-template-identifier: interpolated template passed by bare identifier', () => {
    const code = [
      'const q = `WHERE id = ${req.query.x}`;',
      'db.literal(q);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-unresolvable-identifier: identifier not declared in-file (param/import)', () => {
    const code = [
      'function run(sql: string) {',
      '  return db.literal(sql);',
      '}',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-identifier-bound-to-dynamic: identifier resolves to a non-static value', () => {
    const code = [
      'const raw = req.query.sort;',
      'db.literal(raw);',
    ].join('\n');
    const violations = detectSource(code, 'bad.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it('unsafe-query-template: .query() with an interpolated template', () => {
    const code = 'db.query(`SELECT * FROM ${table} WHERE id = ${id}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-query-concat: .query() with a + concatenation of a non-literal', () => {
    const code = 'db.query(\'SELECT * FROM users WHERE name = \' + userInput);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-pg-object-form-interpolated: { text } with interpolated SQL', () => {
    const code = 'client.query({ text: `SELECT * FROM ${table}`, values: [] });';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-tagged-template: fail-closed on an unrecognized tagged-template arg', () => {
    const code = 'db.literal(sql`SELECT ${x}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('reports the correct 1-indexed line number of the offending call', () => {
    const code = [
      '// line 1',
      '// line 2',
      'db.literal(`WHERE id = ${rawValue}`);',
    ].join('\n');
    const violations = detectSource(code, 'bad.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });
});

describe('check-raw-sql: bare literal/query imported from sequelize', () => {
  const SEQ_LITERAL = "import { literal } from 'sequelize';\n";
  const SEQ_QUERY = "import { query } from 'sequelize';\n";

  it('safe-bare-literal-static: bare literal(\'...\') with a static string', () => {
    const code = SEQ_LITERAL + "literal('DATE(created_at)');";
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-bare-literal-static-concat: bare literal(\'a\' + \'b\') of string literals', () => {
    const code = SEQ_LITERAL
      + "literal('(SELECT MAX(x) FROM t ' + 'WHERE t.id = 1)');";
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('safe-bare-query-static: bare query(\'SELECT 1\') with a static string', () => {
    const code = SEQ_QUERY + "query('SELECT 1');";
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('unsafe-bare-literal-interpolated: bare literal(`... ${userVal}`)', () => {
    const code = SEQ_LITERAL + 'literal(`WHERE x = ${userVal}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('unsafe-bare-literal-dynamic-identifier: init is not a static string', () => {
    const code = SEQ_LITERAL + [
      'const raw = req.query.sort;',
      'literal(raw);',
    ].join('\n');
    const violations = detectSource(code, 'bad.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  it('unsafe-bare-query-template: bare query with an interpolated template', () => {
    const code = SEQ_QUERY + 'query(`SELECT * FROM ${table}`);';
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('import-scoping: bare literal(interpolated) is NOT flagged when literal is not a sequelize import', () => {
    // No `import { literal } from 'sequelize'` — `literal` here is some other
    // helper, so the bare call must not be treated as a raw-SQL sink.
    const code = [
      "import { literal } from './my-helpers';",
      'literal(`WHERE x = ${userVal}`);',
    ].join('\n');
    expect(detectSource(code, 'other.ts')).toHaveLength(0);
  });

  it('import-scoping: honors an alias (`literal as lit`)', () => {
    const code = [
      "import { literal as lit } from 'sequelize';",
      'lit(`WHERE x = ${userVal}`);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });
});

describe('check-raw-sql: suppression comment', () => {
  const SEQ_LITERAL = "import { literal } from 'sequelize';\n";

  it('suppresses a violation with a preceding // sql-check-safe: <reason>', () => {
    const code = SEQ_LITERAL + [
      '// sql-check-safe: sortColumn is allowlist-validated, never user text',
      'literal(resolvedSortColumn);',
    ].join('\n');
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('suppresses when the comment trails on the same line', () => {
    const code = SEQ_LITERAL
      + 'literal(resolvedSortColumn); // sql-check-safe: allowlist-validated';
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('does NOT suppress when the reason is empty/whitespace', () => {
    const code = SEQ_LITERAL + [
      '// sql-check-safe:   ',
      'literal(resolvedSortColumn);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('does NOT suppress an unrelated line (comment two lines above)', () => {
    const code = SEQ_LITERAL + [
      '// sql-check-safe: reason',
      'const x = 1;',
      'literal(resolvedSortColumn);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });
});

describe('check-raw-sql: reassignment / shadowing fail-closed (one-hop guard)', () => {
  // These exercise resolveIdentifierInit through the .query() static-binding
  // path: a `const sql = <static>` initializer would be safe, but the resolver
  // fails closed whenever the binding is ambiguous or mutable, so each case is
  // a violation.
  it('fails closed when a static-bound identifier is later reassigned', () => {
    const code = [
      'let sql = `SELECT 1`;',
      'sql = req.query.evil;',
      'db.query(sql);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('fails closed when the name is declared more than once (shadowing)', () => {
    const code = [
      'const sql = `SELECT 1`;',
      'function inner() { const sql = req.query.evil; }',
      'db.query(sql);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });

  it('fails closed when a same-named function parameter shadows a single valid decl', () => {
    // Exactly ONE variable declaration (trusts the decls.length guard) with a
    // static initializer, shadowed only by a same-named function *parameter*
    // elsewhere in the file. This isolates the `ts.isParameter(...)` branch of
    // resolveIdentifierInit (distinct from the two-declaration case above).
    const code = [
      'const sql = `SELECT 1`;',
      'function inner(sql: string) { return sql; }',
      'db.query(sql);',
    ].join('\n');
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });
});

describe('check-raw-sql: static concat inside .literal() (property-access form)', () => {
  it('safe: X.literal(\'a\' + \'b\') of only string literals', () => {
    const code = "db.literal('(SELECT MAX(x) FROM t ' + 'WHERE t.id = 1)');";
    expect(detectSource(code, 'safe.ts')).toHaveLength(0);
  });

  it('unsafe: X.literal(\'a\' + userVal) concatenates a non-literal', () => {
    const code = "db.literal('WHERE x = ' + userVal);";
    expect(detectSource(code, 'bad.ts')).toHaveLength(1);
  });
});

describe('check-raw-sql: mixed safe + unsafe file', () => {
  it('flags exactly the unsafe subset, leaving safe calls untouched', () => {
    const code = [
      'const query = `SELECT 1`;', //                  line 1
      'db.query(query, values);', //                   line 2  safe (identifier→static)
      'db.query(`SELECT id FROM t WHERE x = :x`, { replacements: { x } });', // line 3  safe
      'db.literal(`WHERE id = ${rawValue}`);', //      line 4  UNSAFE
      'db.query(\'SELECT \' + userInput);', //         line 5  UNSAFE
      'z.literal(\'Create\');', //                     line 6  safe
    ].join('\n');
    const violations = detectSource(code, 'mixed.ts');
    expect(violations.map((v) => v.line).sort((a, b) => a - b)).toEqual([4, 5]);
  });
});

describe('check-raw-sql: directory scan + CLI exit code', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-sql-check-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collectServerFiles skips test dirs, *.test.ts and *.d.ts', () => {
    fs.writeFileSync(path.join(tmpDir, 'real.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'thing.test.ts'), 'export const b = 2;\n');
    fs.writeFileSync(path.join(tmpDir, 'types.d.ts'), 'export type C = number;\n');
    fs.mkdirSync(path.join(tmpDir, 'test'));
    fs.writeFileSync(path.join(tmpDir, 'test', 'fixture.ts'), 'export const d = 3;\n');

    const files = collectServerFiles(tmpDir).map((f) => path.basename(f));
    expect(files).toEqual(['real.ts']);
  });

  it('detect() aggregates violations across scanned files', () => {
    fs.writeFileSync(path.join(tmpDir, 'safe.ts'), 'db.query(`SELECT 1`);\n');
    fs.writeFileSync(path.join(tmpDir, 'bad.ts'), 'db.literal(`x = ${raw}`);\n');
    const violations = detect(collectServerFiles(tmpDir));
    expect(violations).toHaveLength(1);
    expect(path.basename(violations[0].file)).toBe('bad.ts');
  });

  it('main() returns non-zero when a scanned file has a violation', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.ts'), 'db.literal(`x = ${raw}`);\n');
    expect(main([tmpDir])).toBe(1);
  });

  it('main() returns zero when all scanned files are clean', () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.ts'), 'db.query(`SELECT 1`);\n');
    expect(main([tmpDir])).toBe(0);
  });
});

/**
 * CI-wiring safety net: scan the real src/server tree. Asserts the guard is
 * correctly wired against every known raw-SQL site and produces zero violations
 * today. Those sites are:
 *   - 5 `EventEntity.sequelize!.literal(...)` (property-access form) in events.ts
 *     — static subqueries; the calendar id is a `:calendarId` bind parameter
 *   - ~13 bare `literal(...)` (imported from 'sequelize') across 5 service files
 *     (calendar, event_instance, locations, notification, analytics) — all
 *     static strings / static concat, except calendar.ts's allowlist-validated
 *     ORDER BY column, which carries a `// sql-check-safe:` suppression comment
 *   - 1 identifier-bound static `.query()` in job-queue.ts, 2 static `.query()`
 *     in categories.ts
 * Kept isolated from the fixture tests above so those stay fast and independent
 * of tree size.
 */
describe('check-raw-sql: live scan of src/server (CI safety net)', () => {
  it('reports zero violations against the current src/server tree', () => {
    const root = path.resolve(process.cwd(), 'src/server');
    const violations = detect(collectServerFiles(root));
    expect(violations).toEqual([]);
  });
});
