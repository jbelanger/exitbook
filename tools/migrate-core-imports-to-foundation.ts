import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

type ImportSpecifierInfo = {
  exportedName: string;
  localName: string;
  isTypeOnly: boolean;
};

type PackageMigrationResult = {
  packageDir: string;
  changedFiles: number;
  rewrittenImports: number;
  addedFoundationDependency: boolean;
  removedCoreDependency: boolean;
};

const repoRoot = process.cwd();
const foundationRootModule = '@exitbook/foundation';
const foundationTestUtilsModule = '@exitbook/foundation/test-utils';
const coreRootModule = '@exitbook/core';
const coreTestUtilsModule = '@exitbook/core/test-utils';
const coreIdentityModule = '@exitbook/core/identity';

const foundationRootExports = collectPublicExports(path.join(repoRoot, 'packages/foundation/src/index.ts'));
const foundationTestUtilsExports = collectPublicExports(
  path.join(repoRoot, 'packages/foundation/src/__tests__/test-utils.ts')
);

const packageDirs = process.argv.slice(2);

if (packageDirs.length === 0) {
  console.error('Usage: pnpm exec tsx tools/migrate-core-imports-to-foundation.ts <package-dir> [package-dir...]');
  process.exit(1);
}

const results = packageDirs.map((packageDir) => migratePackage(packageDir));

for (const result of results) {
  console.log(
    JSON.stringify(
      {
        packageDir: result.packageDir,
        changedFiles: result.changedFiles,
        rewrittenImports: result.rewrittenImports,
        addedFoundationDependency: result.addedFoundationDependency,
        removedCoreDependency: result.removedCoreDependency,
      },
      null,
      2
    )
  );
}

function migratePackage(packageDirArg: string): PackageMigrationResult {
  const packageDir = path.resolve(repoRoot, packageDirArg);
  const packageJsonPath = path.join(packageDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found for ${packageDirArg}`);
  }

  const sourceFiles = listSourceFiles(packageDir);
  let changedFiles = 0;
  let rewrittenImports = 0;

  for (const filePath of sourceFiles) {
    const originalText = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      originalText,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(filePath)
    );
    const edits: Array<{ start: number; end: number; text: string }> = [];

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) {
        continue;
      }

      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const moduleSpecifier = statement.moduleSpecifier.text;

      if (moduleSpecifier === coreIdentityModule) {
        continue;
      }

      const importClause = statement.importClause;
      if (
        !importClause ||
        importClause.name ||
        !importClause.namedBindings ||
        !ts.isNamedImports(importClause.namedBindings)
      ) {
        continue;
      }

      const importSpecifiers = importClause.namedBindings.elements.map((element) =>
        toImportSpecifierInfo(element, importClause.isTypeOnly)
      );

      if (moduleSpecifier === coreRootModule) {
        const foundationSpecifiers = importSpecifiers.filter((specifier) =>
          foundationRootExports.has(specifier.exportedName)
        );
        if (foundationSpecifiers.length === 0) {
          continue;
        }

        const coreSpecifiers = importSpecifiers.filter(
          (specifier) => !foundationRootExports.has(specifier.exportedName)
        );
        edits.push({
          start: statement.getStart(sourceFile),
          end: statement.getEnd(),
          text: buildImportReplacement({
            coreModule: coreRootModule,
            foundationModule: foundationRootModule,
            coreSpecifiers,
            foundationSpecifiers,
          }),
        });
        rewrittenImports += 1;
        continue;
      }

      if (moduleSpecifier === coreTestUtilsModule) {
        const foundationSpecifiers = importSpecifiers.filter((specifier) =>
          foundationTestUtilsExports.has(specifier.exportedName)
        );
        if (foundationSpecifiers.length === 0) {
          continue;
        }

        const coreSpecifiers = importSpecifiers.filter(
          (specifier) => !foundationTestUtilsExports.has(specifier.exportedName)
        );
        edits.push({
          start: statement.getStart(sourceFile),
          end: statement.getEnd(),
          text: buildImportReplacement({
            coreModule: coreTestUtilsModule,
            foundationModule: foundationTestUtilsModule,
            coreSpecifiers,
            foundationSpecifiers,
          }),
        });
        rewrittenImports += 1;
      }
    }

    collectImportTypeEdits(sourceFile, originalText, edits);

    if (edits.length === 0) {
      continue;
    }

    const updatedText = applyEdits(originalText, edits);
    if (updatedText !== originalText) {
      fs.writeFileSync(filePath, updatedText);
      changedFiles += 1;
    }
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
  const usesFoundation =
    packageContainsImport(packageDir, foundationRootModule) ||
    packageContainsImport(packageDir, foundationTestUtilsModule);
  const usesCore =
    packageContainsImport(packageDir, coreRootModule) ||
    packageContainsImport(packageDir, coreTestUtilsModule) ||
    packageContainsImport(packageDir, coreIdentityModule);

  const addedFoundationDependency = usesFoundation && ensureDependency(packageJson, foundationRootModule);
  const removedCoreDependency = !usesCore && removeDependency(packageJson, coreRootModule);

  if (addedFoundationDependency || removedCoreDependency) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  return {
    packageDir: path.relative(repoRoot, packageDir).replaceAll(path.sep, '/'),
    changedFiles,
    rewrittenImports,
    addedFoundationDependency,
    removedCoreDependency,
  };
}

function collectImportTypeEdits(
  sourceFile: ts.SourceFile,
  sourceText: string,
  edits: Array<{ start: number; end: number; text: string }>
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const moduleSpecifier = node.argument.literal.text;
      const qualifierText = getImportTypeQualifierText(node.qualifier);

      if (moduleSpecifier === coreRootModule && qualifierText && foundationRootExports.has(qualifierText)) {
        edits.push(buildStringLiteralEdit(node.argument.literal, sourceText, foundationRootModule));
      }

      if (moduleSpecifier === coreTestUtilsModule && qualifierText && foundationTestUtilsExports.has(qualifierText)) {
        edits.push(buildStringLiteralEdit(node.argument.literal, sourceText, foundationTestUtilsModule));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function getImportTypeQualifierText(qualifier: ts.EntityName | undefined): string | undefined {
  if (!qualifier) {
    return undefined;
  }

  if (ts.isIdentifier(qualifier)) {
    return qualifier.text;
  }

  return qualifier.right.text;
}

function buildStringLiteralEdit(
  literal: ts.StringLiteral,
  sourceText: string,
  nextModuleSpecifier: string
): { start: number; end: number; text: string } {
  const start = literal.getStart();
  const end = literal.getEnd();
  const quote = sourceText[start] === '"' ? '"' : "'";

  return {
    start,
    end,
    text: `${quote}${nextModuleSpecifier}${quote}`,
  };
}

function getScriptKind(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function listSourceFiles(dirPath: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }

    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(entryPath);
    }
  }

  return results;
}

function collectPublicExports(entryPath: string, seen = new Set<string>()): Set<string> {
  const resolvedEntryPath = resolveTypeScriptModulePath(entryPath);
  if (seen.has(resolvedEntryPath)) {
    return new Set();
  }
  seen.add(resolvedEntryPath);

  const sourceText = fs.readFileSync(resolvedEntryPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    resolvedEntryPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(resolvedEntryPath)
  );
  const exports = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const targetPath = resolveRelativeModulePath(resolvedEntryPath, statement.moduleSpecifier.text);

      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exports.add(element.name.text);
        }
        continue;
      }

      for (const exportName of collectPublicExports(targetPath, seen)) {
        exports.add(exportName);
      }
      continue;
    }

    if (!hasExportModifier(statement)) {
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) {
        exports.add(statement.name.text);
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, exports);
      }
    }
  }

  return exports;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function collectBindingNames(name: ts.BindingName, results: Set<string>): void {
  if (ts.isIdentifier(name)) {
    results.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNames(element.name, results);
    }
  }
}

function resolveRelativeModulePath(fromFilePath: string, moduleSpecifier: string): string {
  return resolveTypeScriptModulePath(path.resolve(path.dirname(fromFilePath), moduleSpecifier));
}

function resolveTypeScriptModulePath(modulePath: string): string {
  const extensionlessModulePath =
    modulePath.endsWith('.js') || modulePath.endsWith('.jsx') ? modulePath.replace(/\.[^.]+$/, '') : modulePath;
  const candidates = [
    modulePath,
    `${extensionlessModulePath}.ts`,
    `${extensionlessModulePath}.tsx`,
    path.join(extensionlessModulePath, 'index.ts'),
    path.join(extensionlessModulePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve module path for ${modulePath}`);
}

function toImportSpecifierInfo(element: ts.ImportSpecifier, declarationIsTypeOnly: boolean): ImportSpecifierInfo {
  return {
    exportedName: element.propertyName?.text ?? element.name.text,
    localName: element.name.text,
    isTypeOnly: declarationIsTypeOnly || element.isTypeOnly,
  };
}

function buildImportReplacement(args: {
  coreModule: string;
  foundationModule: string;
  coreSpecifiers: ImportSpecifierInfo[];
  foundationSpecifiers: ImportSpecifierInfo[];
}): string {
  const statements: string[] = [];

  if (args.foundationSpecifiers.length > 0) {
    statements.push(renderImport(args.foundationModule, args.foundationSpecifiers));
  }

  if (args.coreSpecifiers.length > 0) {
    statements.push(renderImport(args.coreModule, args.coreSpecifiers));
  }

  return statements.join('\n');
}

function renderImport(moduleSpecifier: string, specifiers: ImportSpecifierInfo[]): string {
  if (specifiers.length === 0) {
    throw new Error(`Cannot render empty import for ${moduleSpecifier}`);
  }

  const uniqueSpecifiers = dedupeSpecifiers(specifiers);
  const allTypeOnly = uniqueSpecifiers.every((specifier) => specifier.isTypeOnly);
  const renderedSpecifiers = uniqueSpecifiers.map((specifier) => renderImportSpecifier(specifier, allTypeOnly));
  const typeKeyword = allTypeOnly ? ' type' : '';

  return `import${typeKeyword} { ${renderedSpecifiers.join(', ')} } from '${moduleSpecifier}';`;
}

function dedupeSpecifiers(specifiers: ImportSpecifierInfo[]): ImportSpecifierInfo[] {
  const seen = new Set<string>();
  const results: ImportSpecifierInfo[] = [];

  for (const specifier of specifiers) {
    const key = `${specifier.exportedName}:${specifier.localName}:${specifier.isTypeOnly ? 'type' : 'value'}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(specifier);
  }

  return results;
}

function renderImportSpecifier(specifier: ImportSpecifierInfo, declarationIsTypeOnly: boolean): string {
  const aliasPart =
    specifier.localName === specifier.exportedName
      ? specifier.exportedName
      : `${specifier.exportedName} as ${specifier.localName}`;
  if (!declarationIsTypeOnly && specifier.isTypeOnly) {
    return `type ${aliasPart}`;
  }

  return aliasPart;
}

function applyEdits(sourceText: string, edits: Array<{ start: number; end: number; text: string }>): string {
  return edits
    .sort((left, right) => right.start - left.start)
    .reduce((text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`, sourceText);
}

function packageContainsImport(packageDir: string, moduleSpecifier: string): boolean {
  for (const filePath of listSourceFiles(packageDir)) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    if (sourceText.includes(`'${moduleSpecifier}'`) || sourceText.includes(`"${moduleSpecifier}"`)) {
      return true;
    }
  }

  return false;
}

function ensureDependency(packageJson: Record<string, unknown>, dependencyName: string): boolean {
  const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
  for (const groupName of dependencyGroups) {
    const group = packageJson[groupName];
    if (!isStringMap(group)) {
      continue;
    }

    if (dependencyName in group) {
      return false;
    }
  }

  const dependencies = isStringMap(packageJson.dependencies) ? { ...packageJson.dependencies } : {};
  dependencies[dependencyName] = 'workspace:*';
  packageJson.dependencies = sortStringMap(dependencies);
  return true;
}

function removeDependency(packageJson: Record<string, unknown>, dependencyName: string): boolean {
  let changed = false;
  const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

  for (const groupName of dependencyGroups) {
    const group = packageJson[groupName];
    if (!isStringMap(group) || !(dependencyName in group)) {
      continue;
    }

    const nextGroup = { ...group };
    delete nextGroup[dependencyName];
    packageJson[groupName] = sortStringMap(nextGroup);
    changed = true;
  }

  return changed;
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function sortStringMap(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));
}
