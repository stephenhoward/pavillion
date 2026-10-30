import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { SOURCE_ROOT, describeNode, parse, visit } from './ast';

const ROUTES_FILE = path.join(SOURCE_ROOT, 'client/routes.ts');

export interface ClientRouteScan {
  segments: string[];
  unparseable: string[];
}

/**
 * Reduces a vue-router path to the static top-level segment it claims.
 * Returns null for the root path, empty child paths, and dynamic segments,
 * none of which claim a name a calendar could otherwise use.
 */
export function topLevelSegment(routePath: string): string | null {
  const segment = routePath.replace(/^\//, '').split('/')[0];

  if (segment === '' || segment.startsWith(':')) {
    return null;
  }
  return segment;
}

/**
 * Collects the top-level URL segments the client SPA router owns by parsing
 * src/client/routes.ts, so a route added there without a matching reservation
 * fails instead of silently shadowing a calendar of the same name.
 */
export function clientRouterTopLevelSegments(): ClientRouteScan {
  return topLevelSegmentsOf(fs.readFileSync(ROUTES_FILE, 'utf-8'));
}

/**
 * Reads the array literal bound to `const routes` in `text`. Route objects
 * sitting directly in it are top level. So are the children of the route whose
 * own path is '/', because they mount directly beneath the root rather than
 * under a namespace of their own. Properties are read by name, so their order
 * within a route object does not matter.
 *
 * Only a string-literal `path` can be read. Anything else — a template
 * literal, an identifier, a spread, a route with no `path` — is returned in
 * `unparseable` rather than skipped, because a path this reader cannot see is
 * a segment it cannot check, and silence there is indistinguishable from
 * success. A failure means the reader needs extending, not that the route is
 * wrong.
 */
export function topLevelSegmentsOf(text: string): ClientRouteScan {
  const source = parse(ROUTES_FILE, text);
  const routes = findRoutesArray(source);
  if (!routes) {
    throw new Error('src/client/routes.ts no longer declares `const routes = [...]`; update topLevelSegmentsOf in client-routes.ts');
  }

  const segments = new Set<string>();
  const unparseable: string[] = [];

  const readRoutes = (array: ts.ArrayLiteralExpression, isRootChildren: boolean): void => {
    for (const route of array.elements) {
      if (!ts.isObjectLiteralExpression(route)) {
        unparseable.push(describeNode(source, ROUTES_FILE, route));
        continue;
      }

      const routePath = property(route, 'path');
      if (!routePath || !ts.isStringLiteral(routePath)) {
        unparseable.push(describeNode(source, ROUTES_FILE, routePath ?? route));
        continue;
      }

      const segment = topLevelSegment(routePath.text);
      if (segment) segments.add(segment);

      if (!isRootChildren && routePath.text === '/') {
        const children = property(route, 'children');
        if (children && ts.isArrayLiteralExpression(children)) {
          readRoutes(children, true);
        }
        else if (children) {
          unparseable.push(describeNode(source, ROUTES_FILE, children));
        }
      }
    }
  };

  readRoutes(routes, false);
  return { segments: [...segments], unparseable };
}

function findRoutesArray(source: ts.SourceFile): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;

  visit(source, (node) => {
    if (found || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'routes') return;
    if (node.initializer && ts.isArrayLiteralExpression(node.initializer)) found = node.initializer;
  });
  return found;
}

/**
 * The value of the property called `name` on a route object: the initializer
 * of `name: value`, or the identifier of a `{ name }` shorthand (which this
 * reader cannot resolve). Undefined when the object declares no such property.
 */
function property(route: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of route.properties) {
    if (ts.isPropertyAssignment(member) && propertyName(member.name) === name) return member.initializer;
    if (ts.isShorthandPropertyAssignment(member) && member.name.text === name) return member.name;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}
