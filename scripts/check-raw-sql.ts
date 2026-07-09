/**
 * check-raw-sql.ts — CI regression guard against dynamic values in raw SQL.
 *
 * Pavillion builds a handful of raw-SQL subqueries with Sequelize's
 * `sequelize.literal(...)` (see src/server/calendar/service/*.ts) and a few
 * `.query(...)` calls. This script enforces a single, blunt contract so a
 * future change (human or AI-authored) cannot slip an attacker-influenced value
 * into a raw-SQL sink without CI failing:
 *
 *   **A raw-SQL string must be static. Dynamic values go through bind /
 *   replacement parameters (`:name` / `$1` / `?`), never string interpolation.**
 *
 * That is the whole rule. The checker does NOT try to decide whether an
 * interpolated value was "escaped enough" — it forbids interpolation outright,
 * escaped or not. This is deliberately stricter and far simpler than tracking
 * `escape()` calls: there is no taint analysis to keep in sync with new idioms,
 * and no reliance on `escape()` being the right escaper or being applied
 * correctly. If you need a value in the SQL, bind it; the driver escapes it.
 *
 * Design (see bead pv-o7m5):
 *   - Syntactic parse only (`ts.createSourceFile`), no type checker — nothing
 *     in the rule needs types, and this keeps the scan fast and dependency-free
 *     (reuses the existing `typescript` dep, no new toolchain).
 *   - A pure `detect(files) -> Violation[]` split from a thin returnable
 *     `main()` so both the rule and the CLI exit-code behavior are unit-tested.
 *   - Detection is structural and FAIL-CLOSED: only a static string, a static
 *     `+` concat of string literals, or a one-hop const binding to one of those
 *     passes. Any `${}` substitution, dynamic concat, or unresolved identifier
 *     is a violation. This is the correct default for a security gate.
 *
 * Sink callee shapes recognized (both the dominant idioms in this codebase):
 *   - Property-access form: `X.literal(...)` / `X.query(...)` — any receiver
 *     (`EventEntity.sequelize!.literal`, `db.query`, pg `client.query`),
 *     matched by callee method name without resolving the handle.
 *   - Bare-identifier form: `literal(...)` / `query(...)` imported directly
 *     from 'sequelize' — the dominant `.literal()` idiom here (~13 call sites
 *     across 5 service files). A bare call is only treated as a sink when the
 *     callee name is actually imported from 'sequelize' in that file (import
 *     declarations are parsed per file, aliases honored). This avoids
 *     false-positives on unrelated `literal()` / `query()` helpers.
 *   KNOWN GAP: the element-access form `x['literal'](...)` is NOT recognized.
 *   Out of scope for this syntactic guard; documented, not an accidental hole.
 *
 * Suppression: a single-line comment `// sql-check-safe: <reason>` on the sink
 * call's line or the immediately preceding line suppresses that one violation.
 * The reason is MANDATORY — a `// sql-check-safe:` with an empty/whitespace
 * reason does NOT suppress (fail-closed on the suppression itself). This is the
 * ONLY escape hatch, and it exists for the one thing a bind parameter cannot
 * express: an *identifier* (column / table name, sort direction) that SQL
 * placeholders cannot bind. Such a site MUST come from a hardcoded allowlist,
 * never user text (e.g. the allowlist-validated ORDER BY column in calendar.ts).
 *
 * Known limitations (accepted, documented — not silent gaps):
 *   - A bare sink reached via local destructuring of a default/namespace
 *     sequelize import (e.g. `import Seq from 'sequelize'; const { literal } =
 *     Seq; literal(...)`) is NOT modeled — only named imports from 'sequelize'
 *     and property-access on any receiver are detected.
 *   - Binding resolution is single-hop and only accepts a *static* initializer.
 *     `resolveIdentifierInit` fails CLOSED (returns undefined → the call is a
 *     violation) whenever the resolved identifier is declared more than once,
 *     shadowed by a same-named parameter, or reassigned anywhere in the file.
 *     It does not model control flow beyond that.
 *
 * Scope: `src/server/**` only, excluding `**\/test\/**` and `*.test.ts`.
 * Rationale: this targets the per-request attacker surface. `migrations/**` and
 * `scripts/**` run once at deploy/admin time against internal data (not
 * per-request attacker input); test files carry intentional interpolation in
 * fixtures (e.g. migration tests interpolating a hardcoded `${table}`). These
 * are documented exclusions, not accidental gaps — revisit if a migration ever
 * interpolates request-derived data.
 *
 * Usage:
 *   npx tsx scripts/check-raw-sql.ts [rootDir]   # defaults to src/server
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Violation {
  file: string;
  line: number; // 1-indexed
  message: string;
}

const LITERAL_MESSAGE =
  'unsafe sequelize.literal(...) argument: the SQL text is not static '
  + '(it interpolates a value, concatenates a dynamic value, or is an '
  + 'unresolved identifier). Do not interpolate values into raw SQL — bind them '
  + 'as replacement parameters (:name at the query options `replacements`). If '
  + 'the value is a column/table identifier from a hardcoded allowlist (which a '
  + 'bind parameter cannot express), add `// sql-check-safe: <reason>`.';

const QUERY_MESSAGE =
  'unsafe .query(...) argument: the SQL text is not static '
  + '(interpolated / concatenated / unresolved identifier). Use bind/replacement '
  + 'parameters ($1 / :name / ?) instead of interpolating values into the SQL text.';

/** A static, non-interpolated literal — safe as a raw-SQL fragment on its own. */
function isStaticStringLike(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/**
 * A primitive literal value (string, number, bigint, boolean, null). Broader
 * than isStaticStringLike so `z.literal(true)` / `z.literal(42)` and similar
 * non-SQL `.literal(...)` uses are not false-flagged.
 */
function isPrimitiveLiteral(node: ts.Node): boolean {
  return (
    isStaticStringLike(node)
    || ts.isNumericLiteral(node)
    || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
  );
}

/** True for `=` and every compound-assignment operator (`+=`, `??=`, ...). */
function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * One-hop binding resolution: return the initializer of the single in-file
 * `const/let/var` declaration of `ident`.
 *
 * FAIL-CLOSED (returns undefined → caller treats the call as a violation) when:
 *   - the name is not declared with a variable declaration in this file
 *     (parameter, import, or cross-file — unresolvable), OR
 *   - the name is declared more than once (redeclaration / block shadowing —
 *     which declaration reaches the use is scope-dependent and this syntactic
 *     pass does not model scope), OR
 *   - a same-named parameter shadows it, OR
 *   - the name is reassigned anywhere in the file (`x = ...`, `x += ...`,
 *     `x++`) — a later `sql = req.query.evil` must not be trusted as static.
 *
 * The single-declaration + no-reassignment requirement closes the fail-open
 * reassignment/shadowing gap while staying a bounded, scope-unaware single hop.
 */
function resolveIdentifierInit(
  ident: ts.Identifier,
  sf: ts.SourceFile,
): ts.Expression | undefined {
  const name = ident.text;
  const decls: ts.VariableDeclaration[] = [];
  let shadowedOrReassigned = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      decls.push(node);
    }
    else if (
      ts.isParameter(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      shadowedOrReassigned = true;
    }
    else if (
      ts.isBinaryExpression(node)
      && isAssignmentOperatorKind(node.operatorToken.kind)
      && ts.isIdentifier(node.left)
      && node.left.text === name
    ) {
      shadowedOrReassigned = true;
    }
    else if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken
        || node.operator === ts.SyntaxKind.MinusMinusToken)
      && ts.isIdentifier(node.operand)
      && node.operand.text === name
    ) {
      shadowedOrReassigned = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (shadowedOrReassigned || decls.length !== 1) {
    return undefined; // fail closed
  }
  return decls[0].initializer;
}

/** A `+` chain whose every leaf is a static string literal. */
function isStaticConcat(node: ts.Node): boolean {
  if (isStaticStringLike(node)) {
    return true;
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return isStaticConcat(node.left) && isStaticConcat(node.right);
  }
  return false;
}

/**
 * The single safety predicate: the SQL text is STATIC. That means a string
 * literal, a no-substitution template, a static `+` concat of those, or a
 * one-hop const binding to one of those (`const q = \`...\`; query(q)`).
 *
 * Everything else is unsafe: a `${}` substitution (escaped or not — we do not
 * care, values belong in bind parameters), a dynamic concat, or an identifier
 * that does not resolve to a static initializer. `depth` bounds resolution to a
 * single hop so a chain of identifiers fails closed.
 */
function isStaticSql(arg: ts.Expression, sf: ts.SourceFile, depth = 0): boolean {
  if (isStaticConcat(arg)) {
    // Covers plain string literals, no-substitution templates, and a `+` chain
    // of only those (e.g. a multi-line subquery joined with `+`).
    return true;
  }
  if (ts.isIdentifier(arg) && depth === 0) {
    const init = resolveIdentifierInit(arg, sf);
    return !!init && isStaticSql(init, sf, depth + 1);
  }
  return false; // fail-closed default: template substitution, dynamic concat, ...
}

/** Safe-list for `sequelize.literal(arg)`. */
function literalArgIsSafe(arg: ts.Expression, sf: ts.SourceFile): boolean {
  // Non-SQL primitive uses like `z.literal(42)` / `z.literal(true)`.
  if (isPrimitiveLiteral(arg)) {
    return true;
  }
  return isStaticSql(arg, sf);
}

/** Safe-list for the SQL argument of `.query(arg, ...)`. */
function queryArgIsSafe(arg: ts.Expression, sf: ts.SourceFile): boolean {
  if (ts.isObjectLiteralExpression(arg)) {
    // pg object form: { text, values }. Check the `text` property; other
    // properties (values/name) do not carry injectable SQL.
    const textValue = getTextPropertyValue(arg);
    return !!textValue && isStaticSql(textValue, sf);
  }
  return isStaticSql(arg, sf);
}

/** Extract the value expression of a `text` property from a pg object form. */
function getTextPropertyValue(obj: ts.ObjectLiteralExpression): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop)
      && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
      && prop.name.text === 'text'
    ) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'text') {
      return prop.name;
    }
  }
  return undefined;
}

type SinkKind = 'literal' | 'query';

/**
 * Parse the file's import declarations and return a map of local binding name →
 * sink kind for `literal` / `query` imported from 'sequelize'. Handles aliasing
 * (`import { literal as lit } from 'sequelize'` → `lit` maps to 'literal').
 * A bare-identifier call is only a sink when its callee name is in this map, so
 * unrelated `literal()` / `query()` helpers in other files are never flagged.
 */
function collectSequelizeSinkNames(sf: ts.SourceFile): Map<string, SinkKind> {
  const map = new Map<string, SinkKind>();
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt)
      && ts.isStringLiteral(stmt.moduleSpecifier)
      && stmt.moduleSpecifier.text === 'sequelize'
      && stmt.importClause?.namedBindings
      && ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        const exported = (el.propertyName ?? el.name).text; // original export name
        if (exported === 'literal' || exported === 'query') {
          map.set(el.name.text, exported); // local binding name
        }
      }
    }
  }
  return map;
}

const SUPPRESS_RE = /\/\/\s*sql-check-safe:(.*)$/;

/**
 * A violation at `lineNo` (1-indexed) is suppressed iff that line or the line
 * immediately above carries `// sql-check-safe: <reason>` with a NON-EMPTY
 * reason. An empty/whitespace reason never suppresses (fail-closed).
 */
function isSuppressed(lines: string[], lineNo: number): boolean {
  for (const idx of [lineNo - 1, lineNo - 2]) { // current line, then preceding (0-indexed)
    const text = lines[idx];
    if (text === undefined) {
      continue;
    }
    const m = SUPPRESS_RE.exec(text);
    if (m && m[1].trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a single source string and return raw-SQL violations. Exported so the
 * rule can be unit-tested with inline fixtures (fast, tree-size-independent).
 */
export function detectSource(code: string, fileName: string): Violation[] {
  const sf = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const lines = code.split(/\r?\n/);
  const sequelizeSinks = collectSequelizeSinkNames(sf);
  const violations: Violation[] = [];

  const record = (node: ts.CallExpression, method: SinkKind): void => {
    const arg = node.arguments[0];
    if (!arg) {
      return;
    }
    const safe =
      method === 'literal'
        ? literalArgIsSafe(arg, sf)
        : queryArgIsSafe(arg, sf);
    if (safe) {
      return;
    }
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const lineNo = line + 1;
    if (isSuppressed(lines, lineNo)) {
      return;
    }
    violations.push({
      file: fileName,
      line: lineNo,
      message: method === 'literal' ? LITERAL_MESSAGE : QUERY_MESSAGE,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        // `X.literal(...)` / `X.query(...)` — any receiver.
        const method = callee.name.text;
        if (method === 'literal' || method === 'query') {
          record(node, method);
        }
      }
      else if (ts.isIdentifier(callee)) {
        // Bare `literal(...)` / `query(...)` imported from 'sequelize'.
        const kind = sequelizeSinks.get(callee.text);
        if (kind) {
          record(node, kind);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return violations;
}

/** Read and scan each file path. */
export function detect(filePaths: string[]): Violation[] {
  const out: Violation[] = [];
  for (const filePath of filePaths) {
    const code = fs.readFileSync(filePath, 'utf8');
    out.push(...detectSource(code, filePath));
  }
  return out;
}

/**
 * Recursively collect `.ts` files under `root`, excluding `test` directories,
 * `*.test.ts`, `*.d.ts`, and `node_modules` (see the scope note at the top).
 */
export function collectServerFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === 'node_modules') {
          continue;
        }
        walk(full);
      }
      else if (
        entry.isFile()
        && full.endsWith('.ts')
        && !full.endsWith('.test.ts')
        && !full.endsWith('.d.ts')
      ) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

/**
 * CLI entry as a pure function returning the process exit code (1 on any
 * violation, else 0). Returnable so the CI-gate behavior is unit-testable.
 */
export function main(argv: string[] = process.argv.slice(2)): number {
  const root = path.resolve(argv[0] ?? 'src/server');
  const files = collectServerFiles(root);
  const violations = detect(files);

  for (const v of violations) {
    const rel = path.relative(process.cwd(), v.file);
    process.stderr.write(`${rel}:${v.line} — ${v.message}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(`\ncheck-raw-sql: ${violations.length} violation(s) found.\n`);
    return 1;
  }
  process.stdout.write(`check-raw-sql: no raw-SQL violations found in ${files.length} file(s).\n`);
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
