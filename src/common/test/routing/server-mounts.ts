import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SOURCE_ROOT = path.resolve(__dirname, '../../..');
const SERVER_ROOT = path.join(SOURCE_ROOT, 'server');

/**
 * The page router. Its paths are RegExp, `new RegExp(...)` and call-built
 * shapes a syntactic scan cannot read; their dispositions are pinned over HTTP
 * in src/server/common/test/app_routes.test.ts and by stack walk in
 * src/common/test/routing/public-url-contract.test.ts instead.
 */
const EXEMPT_FILE = path.join(SERVER_ROOT, 'app_routes.ts');

const APP_VERBS = new Set(['use', 'get', 'post', 'put', 'patch', 'delete', 'all']);

export interface ServerMountScan {
  segments: string[];
  unparseable: string[];
}

/**
 * Collects every top-level URL segment the server mounts on the Express app,
 * by parsing src/server/** rather than trusting a hand-kept list.
 *
 * Recognized shapes:
 * - `app.<verb>('/x', ...)` and `app.use(['/x', '/y'], ...)`
 * - `<receiver>.installHandlers(app, '/x')`
 * - a root mount, `<receiver>.installHandlers(app, '/')`, where the receiver is
 *   a same-file `const r = new C(...)` and `C` is imported: the segments are
 *   read from the `router.<verb>('/x', ...)` calls in C's file
 * - `app.use('/', X)` where X comes from src/server/app_routes.ts (exempt)
 *
 * Calls with no path (`app.use(middleware)`, `installHandlers(app)`) and the
 * one-argument `app.get(name)` settings read claim nothing. So does
 * `app.use(routePrefix, router)` inside an `installHandlers` method, whose
 * prefix is claimed at the call site. Any other shape in path position is
 * returned in `unparseable` rather than skipped: a path this scan cannot read
 * is a segment it cannot check.
 */
export function serverMountedSegments(): ServerMountScan {
  const segments = new Set<string>();
  const unparseable: string[] = [];

  for (const file of serverSourceFiles(SERVER_ROOT)) {
    const source = parse(file);

    visit(source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
        return;
      }
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const describe = () => describeNode(source, file, node);

      let pathArg: ts.Expression | undefined;
      if (APP_VERBS.has(method) && isIdentifier(receiver, 'app')) {
        if (method === 'get' && node.arguments.length === 1) return;
        pathArg = node.arguments[0];
        if (isPathlessUse(method, node, pathArg)) return;
        if (pathArg && ts.isIdentifier(pathArg) && isForwardedPrefix(pathArg)) return;
      }
      else if (method === 'installHandlers' && node.arguments.length > 0 && isIdentifier(node.arguments[0], 'app')) {
        pathArg = node.arguments[1];
        if (!pathArg) return;
      }
      else {
        return;
      }

      const paths = literalPaths(pathArg);
      if (!paths) {
        unparseable.push(describe());
        return;
      }

      for (const mountPath of paths) {
        if (mountPath === '/') {
          const resolved = method === 'installHandlers'
            ? rootMountedRouterSegments(source, file, receiver)
            : rootMountedAppRoutes(source, file, node.arguments[1]);
          if (resolved === null) {
            unparseable.push(describe());
          }
          else {
            resolved.forEach(segment => segments.add(segment));
          }
          continue;
        }
        const segment = firstSegment(mountPath);
        if (segment) segments.add(segment);
      }
    });
  }

  return { segments: [...segments].sort(), unparseable };
}

function serverSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'test') files.push(...serverSourceFiles(fullPath));
    }
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && fullPath !== EXEMPT_FILE) {
      files.push(fullPath);
    }
  }
  return files;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

function isIdentifier(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}

function firstSegment(mountPath: string): string | null {
  return mountPath.replace(/^\//, '').split('/')[0] || null;
}

function describeNode(source: ts.SourceFile, file: string, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  const text = node.getText(source).split('\n')[0];
  return `${path.relative(SOURCE_ROOT, file)}:${line + 1}: ${text}`;
}

/**
 * A string literal or an array of them, as their values; null for anything else.
 */
function literalPaths(node: ts.Expression): string[] | null {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteral)) {
    return node.elements.map(element => (element as ts.StringLiteral).text);
  }
  return null;
}

/**
 * `app.use(fn)`, `app.use(middleware())`, `app.use((req, res, next) => ...)`:
 * middleware with no path, which claims no segment.
 */
function isPathlessUse(method: string, call: ts.CallExpression, pathArg: ts.Expression | undefined): boolean {
  if (method !== 'use' || !pathArg) return method === 'use';
  if (ts.isArrowFunction(pathArg) || ts.isFunctionExpression(pathArg)) return true;
  return call.arguments.length === 1 && (ts.isIdentifier(pathArg) || ts.isCallExpression(pathArg));
}

/**
 * Whether an identifier is a parameter of the enclosing `installHandlers`
 * method — a prefix the caller supplies and the call-site scan already reads.
 */
function isForwardedPrefix(identifier: ts.Identifier): boolean {
  let node: ts.Node | undefined = identifier.parent;

  while (node && !ts.isFunctionLike(node)) node = node.parent;
  if (!node || !ts.isMethodDeclaration(node) || !isIdentifier(node.name, 'installHandlers')) return false;

  return node.parameters.some(parameter => isIdentifier(parameter.name, identifier.text));
}

/**
 * Finds the same-file declaration that binds `name`, including a name bound
 * inside an object destructuring pattern.
 */
function findDeclaration(source: ts.SourceFile, name: string): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;

  visit(source, (node) => {
    if (found || !ts.isVariableDeclaration(node)) return;
    const binds = ts.isIdentifier(node.name)
      ? node.name.text === name
      : ts.isObjectBindingPattern(node.name)
        && node.name.elements.some(element => isIdentifier(element.name, name));
    if (binds) found = node;
  });
  return found;
}

/**
 * Maps an identifier to the file its import declaration points at, or null.
 */
function importedFile(source: ts.SourceFile, file: string, name: string): string | null {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map(element => element.name.text)
      : [];
    if (clause?.name?.text !== name && !named.includes(name)) continue;

    const specifier = statement.moduleSpecifier.text;
    const base = specifier.startsWith('@/')
      ? path.join(SOURCE_ROOT, specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
    if (!base) return null;

    return [`${base}.ts`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate)) ?? null;
  }
  return null;
}

/**
 * Segments claimed by `receiver.installHandlers(app, '/')`, read from the
 * `router.<verb>(...)` calls in the receiver's class file. Null when the
 * receiver cannot be resolved or its routes cannot all be read.
 */
function rootMountedRouterSegments(source: ts.SourceFile, file: string, receiver: ts.Expression): string[] | null {
  if (!ts.isIdentifier(receiver)) return null;
  const initializer = findDeclaration(source, receiver.text)?.initializer;
  if (!initializer || !ts.isNewExpression(initializer) || !ts.isIdentifier(initializer.expression)) return null;

  const classFile = importedFile(source, file, initializer.expression.text);
  if (!classFile) return null;

  const classSource = parse(classFile);
  const segments = new Set<string>();
  let readable = true;

  visit(classSource, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!isIdentifier(node.expression.expression, 'router') || !APP_VERBS.has(node.expression.name.text)) return;

    const pathArg = node.arguments[0];
    if (pathArg && ts.isStringLiteral(pathArg)) {
      const segment = firstSegment(pathArg.text);
      if (segment) segments.add(segment);
    }
    else if (node.expression.name.text !== 'use') {
      readable = false;
    }
  });

  return readable && segments.size > 0 ? [...segments] : null;
}

/**
 * `app.use('/', X)` is accepted only when X derives from the exempt page
 * router module; an empty result means "exempt", null means "unreadable".
 */
function rootMountedAppRoutes(source: ts.SourceFile, file: string, mounted: ts.Expression | undefined): string[] | null {
  if (!mounted || !ts.isIdentifier(mounted)) return null;
  let origin: ts.Expression | undefined = findDeclaration(source, mounted.text)?.initializer;

  while (origin && (ts.isCallExpression(origin) || ts.isNewExpression(origin))) {
    origin = origin.expression;
  }
  if (!origin || !ts.isIdentifier(origin)) return null;

  return importedFile(source, file, origin.text) === EXEMPT_FILE ? [] : null;
}
