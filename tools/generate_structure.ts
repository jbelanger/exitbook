import * as ts from 'typescript';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

let out = '';

for (const file of files) {
  const src = readFileSync(`${root}/${file}`, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const decls: string[] = [];

  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node)) continue;

    if (ts.isFunctionDeclaration(node) && node.body) {
      decls.push(src.substring(node.getStart(sf), node.body.getStart(sf)).trimEnd());
    } else if (ts.isClassDeclaration(node)) {
      if (node.members.length === 0) {
        decls.push(node.getText(sf));
      } else {
        let cls = src.substring(node.getStart(sf), node.members[0].getStart(sf));
        for (const m of node.members) {
          if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) && m.body) {
            cls += src.substring(m.getStart(sf), m.body.getStart(sf)).trimEnd() + '\n';
          } else {
            cls += m.getText(sf) + '\n';
          }
        }
        decls.push(cls + '}');
      }
    } else if (ts.isVariableStatement(node)) {
      const init = node.declarationList.declarations[0]?.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && ts.isBlock(init.body)) {
        decls.push(src.substring(node.getStart(sf), init.body.getStart(sf)).trimEnd());
      } else {
        decls.push(node.getText(sf));
      }
    } else if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node)
    ) {
      decls.push(node.getText(sf));
    }
  }

  if (decls.length > 0) {
    out += `--- ${file}\n${decls.join('\n')}\n`;
  }
}

writeFileSync(`${root}/repo_structure.txt`, out);
console.log('Done: repo_structure.txt');
