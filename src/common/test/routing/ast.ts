import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * Syntax-tree primitives shared by the routing tripwires in this directory,
 * which read route tables out of source files rather than trusting a
 * hand-kept list. Walking the parsed tree, not the characters, is what makes
 * them immune to comments, string contents and reformatting.
 */

export const SOURCE_ROOT = path.resolve(__dirname, '../../..');

/**
 * Parses `file`, reading it from disk unless `text` is supplied (fixtures).
 */
export function parse(file: string, text: string = fs.readFileSync(file, 'utf-8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

export function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

export function isIdentifier(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}

/**
 * `<file relative to src>:<line>: <first line of the node's text>`, for
 * naming a node a tripwire could not read.
 */
export function describeNode(source: ts.SourceFile, file: string, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  const text = node.getText(source).split('\n')[0];
  return `${path.relative(SOURCE_ROOT, file)}:${line + 1}: ${text}`;
}
