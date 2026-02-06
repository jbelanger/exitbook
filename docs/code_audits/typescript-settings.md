V2 Architecture Audit: TypeScript Settings & Best Practices

     ---
     1. Dependency Audit (TS Tooling)

     1a. Finding: @trivago/prettier-plugin-sort-imports installed but unused alongside perfectionist/sort-imports
    DONE
     What exists:
     The root package.json declares @trivago/prettier-plugin-sort-imports (line 44) as a devDependency. However, the .prettierrc at /Users/joel/Dev/exitbook/.prettierrc does not reference this plugin
     -- it only loads prettier-plugin-packagejson. Import sorting is actually handled by eslint-plugin-perfectionist in /Users/joel/Dev/exitbook/eslint.config.js (lines 88-95).

     Why it's a problem:
     Dead dependency. It pulls in @babel/traverse and the Babel parser into node_modules, adding install time and confusion about which tool is authoritative for import ordering. Two competing tools
     for the same job means developers may not know which one to configure.

     What V2 should do:
     Remove @trivago/prettier-plugin-sort-imports entirely. The ESLint perfectionist plugin already handles import sorting with autofixes.

     Needs coverage:

     ┌──────────────────────────┬─────────────────────────┬───────────────────────────────────────────┐
     │    Current capability    │ Covered by replacement? │                   Notes                   │
     ├──────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Automatic import sorting │ Yes                     │ perfectionist/sort-imports already active │
     ├──────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Prettier integration     │ N/A                     │ Plugin is not loaded in .prettierrc       │
     └──────────────────────────┴─────────────────────────┴───────────────────────────────────────────┘
     Surface: 1 file (package.json), 0 call-sites (unused)

     Leverage: Low (cleanup only, but removes a confusing dead dependency)

     ---
     1b. Finding: @types/jest, esbuild, esbuild-plugin-pino, @types/triple-beam, triple-beam in @exitbook/logger
     DONE

     What exists:
     /Users/joel/Dev/exitbook/packages/logger/package.json (lines 24-31) declares @types/jest, esbuild, esbuild-plugin-pino, @types/triple-beam, and triple-beam as devDependencies. The project uses
     Vitest (not Jest) for testing. A search for triple-beam and esbuild usage in the logger source (packages/logger/src) returns zero matches.

     Why it's a problem:
     Stale dependencies inflate install size and mislead contributors about the logger's actual toolchain. @types/jest can also cause ambient type conflicts with Vitest's global types.

     What V2 should do:
     Remove all five packages from @exitbook/logger's devDependencies.

     Needs coverage:
     ┌────────────────────────┬─────────────────────────┬──────────────────────────────────────────────┐
     │   Current capability   │ Covered by replacement? │                    Notes                     │
     ├────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Jest type augmentation │ Not needed              │ Vitest is the test runner                    │
     ├────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Esbuild bundling       │ Not needed              │ Logger is consumed via src/index.ts directly │
     ├────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ triple-beam types      │ Not needed              │ No references in source                      │
     └────────────────────────┴─────────────────────────┴──────────────────────────────────────────────┘
     Surface: 1 file (packages/logger/package.json), 0 call-sites

     Leverage: Low (hygiene)

     ---
     1c. Finding: reflect-metadata dependency is misleading

DONE
What exists:
reflect-metadata is declared as a dependency in packages/blockchain-providers/package.json (line 49), packages/price-providers/package.json (line 29), and apps/cli/package.json (line 47). It is
imported in exactly one place: apps/cli/src/index.ts (line 2: import 'reflect-metadata'). The @RegisterApiClient decorator in
/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/registry/decorators.ts does NOT use Reflect.metadata or emitDecoratorMetadata. It is a simple class decorator that calls
ProviderRegistry.register().

     Why it's a problem:
     reflect-metadata is a polyfill for the Reflect Metadata proposal (used by NestJS, TypeORM, etc.). The codebase does not use emitDecoratorMetadata (confirmed: no tsconfig has it). The sole import
     is a dead side-effect import. Declaring it as a dependency in three packages creates false coupling and suggests the project depends on runtime metadata reflection, which it does not.

     What V2 should do:
     Remove reflect-metadata from all package.json files and the import in apps/cli/src/index.ts.

     Needs coverage:

     ┌────────────────────────────┬─────────────────────────┬──────────────────────────────────┐
     │     Current capability     │ Covered by replacement? │              Notes               │
     ├────────────────────────────┼─────────────────────────┼──────────────────────────────────┤
     │ Runtime decorator metadata │ Not used                │ emitDecoratorMetadata is not set │
     ├────────────────────────────┼─────────────────────────┼──────────────────────────────────┤
     │ @RegisterApiClient         │ Unaffected              │ Does not use Reflect API         │
     └────────────────────────────┴─────────────────────────┴──────────────────────────────────┘
     Surface: 3 package.json files, 1 import statement

     Leverage: Medium (removes misleading architectural signal and a transitive dep)

     ---
     2. Architectural Seams (TS Configuration)

     2a. Finding: Cross-package include paths violate package boundaries

DONE
What exists:
Two tsconfig.json files include source files from other packages via relative paths:

     - /Users/joel/Dev/exitbook/packages/blockchain-providers/tsconfig.json (line 7):
     "include": ["src", "../../core/src/utils/type-guard-utils.ts"]
     - /Users/joel/Dev/exitbook/packages/ingestion/tsconfig.json (lines 7-12):
     "include": [
       "src",
       "../data/src/repositories/__tests__/raw-data-repository.test.ts",
       "../data/src/repositories/import-session-repository.ts",
       "../data/src/repositories/raw-data-repository.ts"
     ]

     Why it's a problem:
     This is a layering violation at the TypeScript project level. The include directive tells tsc to type-check those files as part of the current project. This defeats the purpose of package
     boundaries: changes to @exitbook/data internal files now break the @exitbook/ingestion type check. It also means the ingestion package's tsconfig claims ownership of data package test files. Thi
      likely indicates unresolved dependency direction problems: ingestion needs types from data that are not properly exported.

     What V2 should do:
     1. Export needed types from @exitbook/core and @exitbook/data through their barrel (index.ts).
     2. Remove all cross-package relative paths from include arrays.
     3. Use TypeScript project references (composite + references) if cross-project type awareness is needed.

     Needs coverage:
     ┌────────────────────────────────┬─────────────────────────────────────────────────────────┬────────────────────────────┐
     │       Current capability       │                 Covered by replacement?                 │           Notes            │
     ├────────────────────────────────┼─────────────────────────────────────────────────────────┼────────────────────────────┤
     │ Type-check cross-package files │ Yes (via proper exports + imports)                      │ Cleaner than include hacks │
     ├────────────────────────────────┼─────────────────────────────────────────────────────────┼────────────────────────────┤
     │ Test file visibility           │ Yes (test files should be checked by their own package) │                            │
     └────────────────────────────────┴─────────────────────────────────────────────────────────┴────────────────────────────┘
     Surface: 2 tsconfig.json files, ~5 cross-package path entries

     Leverage: High (this undermines the entire package boundary model)

     ---
     2b. Finding: events package has contradictory tsconfig vs package.json

DONE
What exists:
/Users/joel/Dev/exitbook/packages/events/tsconfig.json sets outDir: "dist", declaration: true, declarationMap: true -- indicating it should emit compiled output. But
/Users/joel/Dev/exitbook/packages/events/package.json has "build": "tsc --noEmit" (line 13) and "main": "src/index.ts" (line 10), meaning it never actually emits and consumers resolve to the raw
.ts source.

     Why it's a problem:
     The tsconfig declares an intent to emit declarations that the build script explicitly suppresses. This is dead configuration that misleads anyone trying to understand the build pipeline. The
     events package behaves identically to every other package (raw .ts source consumed via workspace protocol) but its tsconfig suggests otherwise.

     What V2 should do:
     Align events/tsconfig.json with the rest of the monorepo: noEmit: true, allowImportingTsExtensions: true, remove outDir/rootDir/declaration/declarationMap.

     Needs coverage:

     ┌────────────────────┬─────────────────────────┬────────────────────────────────────┐
     │ Current capability │ Covered by replacement? │               Notes                │
     ├────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Type checking      │ Yes                     │ noEmit still runs the type checker │
     ├────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Declaration files  │ Not used                │ Build script already does --noEmit │
     └────────────────────┴─────────────────────────┴────────────────────────────────────┘
     Surface: 1 file

     Leverage: Low (consistency fix)

     ---
     3. Pattern Re-evaluation (TS Patterns)

     3a. Finding: experimentalDecorators enabled but codebase uses simple function patterns

DONE
What exists:
The shared base config at /Users/joel/Dev/exitbook/packages/tsconfig/tsconfig.json (line 18) enables experimentalDecorators: true. This is a project-wide setting. The only decorator usage is
@RegisterApiClient in packages/blockchain-providers/ (29 files). The decorator implementation at /Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/registry/decorators.ts is a simpl
class decorator -- it does not use parameter decorators, method decorators, property decorators, or Reflect.metadata. It is a pure function that calls ProviderRegistry.register(factory).

     Why it's a problem:
     TypeScript 5.0+ supports TC39 standard decorators (Stage 3, now shipping). The experimentalDecorators flag enables the legacy TypeScript decorator implementation, which has different semantics
     from the standard. With TS 5.9 and Node 23, the standard decorators are fully supported. Enabling experimentalDecorators globally:
     1. Prevents adoption of the TC39 standard decorator syntax.
     2. Applies to all 13 packages when only 1 uses decorators.
     3. The decorator pattern used here is so simple it could be replaced with a plain function call (no decorator needed at all).

     What V2 should do:
     Either:
     - Option A (preferred): Replace @RegisterApiClient(metadata) with an explicit ProviderRegistry.register(...) call after the class definition. This removes the need for any decorator flag. The
     decorator adds zero capability that a function call does not.
     - Option B: Migrate to TC39 standard decorators (remove experimentalDecorators, update decorator signature to match the https://github.com/tc39/proposal-decorators).

     Needs coverage:
     ┌───────────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────────┐
     │          Current capability           │     Covered by replacement?     │                Notes                │
     ├───────────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────────┤
     │ Auto-registration at class definition │ Yes (function call after class) │ Equivalent behavior                 │
     ├───────────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────────┤
     │ Metadata attachment                   │ Yes                             │ Already passed as argument          │
     ├───────────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────────┤
     │ Co-location with class                │ Yes                             │ Call placed immediately after class │
     └───────────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────────┘
     Surface: 29 decorator call-sites, 1 decorator definition, 1 tsconfig option

     Leverage: High (removes legacy flag from entire project, simplifies mental model)

     ---
     3b. Finding: Mixed .ts and .js import extensions across the codebase

DONE
What exists:
Across packages and apps: - ~1,095 imports use .js extensions (e.g., from './foo.js') - ~125 imports use .ts extensions (e.g., from './foo.ts') - 0 imports use extensionless paths

     All packages have allowImportingTsExtensions: true + noEmit: true. The CLI's tsconfig also has these flags. The base tsconfig sets module: "NodeNext" + moduleResolution: "NodeNext", which
     requires explicit file extensions.

     The .ts imports are concentrated in packages/blockchain-providers/ (~60), packages/core/ (~15), and packages/ingestion/ (~20), with the remaining ~30 scattered elsewhere. The .js imports dominat
      everywhere.

     Why it's a problem:
     Mixed extensions within the same codebase create confusion about which convention to follow. Since the project never emits (all packages use noEmit: true or are consumed via raw .ts by tsx/tsup)
      the .js extensions are a fiction -- there are no .js files being resolved. The .ts extensions are technically more accurate for a non-emitting project, but the .js convention is more portable
     (works if you ever do emit).

     What V2 should do:
     Pick one convention and enforce it. Given the project uses noEmit everywhere and is never consumed as compiled JS by external packages (all private: true):
     - Adopt .ts extensions (they reflect actual file locations, and allowImportingTsExtensions is already enabled everywhere). OR
     - Adopt .js extensions (more conventional for NodeNext, portable if you ever emit).

     Either way, enforce it via an ESLint rule. The inconsistency is the problem, not the specific choice.

     Needs coverage:
     ┌─────────────────────┬──────────────────────────────────────────────────┬───────┐
     │ Current capability  │             Covered by replacement?              │ Notes │
     ├─────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Module resolution   │ Yes (either extension works with current config) │       │
     ├─────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Portability to emit │ .js is better if emit is ever needed             │       │
     ├─────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Developer clarity   │ Yes (one convention eliminates confusion)        │       │
     └─────────────────────┴──────────────────────────────────────────────────┴───────┘
     Surface: ~125 files with .ts imports need changing (if standardizing on .js), or ~1,095 files (if standardizing on .ts)

     Leverage: Medium (consistency, reduces new-contributor confusion)

     ---
     3c. Finding: allowSyntheticDefaultImports is redundant with esModuleInterop

DONE
What exists:
The base tsconfig at /Users/joel/Dev/exitbook/packages/tsconfig/tsconfig.json (line 6) sets allowSyntheticDefaultImports: true and (line 15) sets esModuleInterop: true.

     Why it's a problem:
     When esModuleInterop is true, TypeScript automatically implies allowSyntheticDefaultImports: true. Setting both is redundant and adds config noise. This is a minor point but contributes to "carg
      cult" configuration where developers add flags without understanding what they imply.

     What V2 should do:
     Remove allowSyntheticDefaultImports: true from the base tsconfig. esModuleInterop: true already covers it.

     Surface: 1 file, 1 line

     Leverage: Low (config hygiene)

     ---
     3d. Finding: strictNullChecks is redundant with strict

DONE
What exists:
The base tsconfig at /Users/joel/Dev/exitbook/packages/tsconfig/tsconfig.json sets both strict: true (line 7) and strictNullChecks: true (line 19).

     Why it's a problem:
     strict: true enables all strict-family flags including strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitAny, noImplicitThis, alwaysStrict, and
     useUnknownInCatchVariables. Listing strictNullChecks separately adds noise. Similarly, useUnknownInCatchVariables: true (line 10) is also implied by strict.

     What V2 should do:
     Remove both strictNullChecks: true and useUnknownInCatchVariables: true from the base tsconfig. They are already covered by strict: true.

     Surface: 1 file, 2 lines

     Leverage: Low (config hygiene)

     ---
     4. Data Layer (TS Configuration Aspects)

     4a. Finding: No TypeScript project references for incremental builds

DONE
What exists:
The monorepo has 13 packages each with their own tsconfig.json, all extending the shared base. None use composite: true or references. The build command is pnpm -r run build, which runs tsc
--noEmit sequentially in each package via pnpm's topological sort.

     Why it's a problem:
     Without project references, tsc cannot do incremental cross-package type checking. Every pnpm build re-checks every package from scratch. For a 13-package monorepo with complex blockchain
     provider types, this adds up. Additionally, the ESLint config uses projectService: true (line 39 of eslint.config.js) which can benefit from project references for faster type-aware linting.

     However, the project uses noEmit everywhere (packages are consumed via raw .ts), and project references require composite which requires declaration. This creates a tension: project references
     are designed for emit-based workflows.

     What V2 should do:
     Consider two approaches:
     - Option A: Adopt composite: true + declaration: true across packages, use tsc --build for incremental checking. This gives proper cross-project incremental checking but requires emitting .d.ts
     files.
     - Option B: Stay with current approach but accept the tradeoff. For a private monorepo that never publishes packages, the current noEmit + raw .ts consumption is simpler.

     Given the project is private and all packages use workspace:*, Option B is defensible. The cost of Option A (managing .d.ts output, .tsbuildinfo caches, etc.) may exceed the benefit.

     Needs coverage:
     ┌────────────────────────────┬─────────────────────────┬───────────────────────────────────────┐
     │     Current capability     │ Covered by replacement? │                 Notes                 │
     ├────────────────────────────┼─────────────────────────┼───────────────────────────────────────┤
     │ Type checking all packages │ Yes (both options)      │                                       │
     ├────────────────────────────┼─────────────────────────┼───────────────────────────────────────┤
     │ Simple config              │ Only Option B           │ Option A adds complexity              │
     ├────────────────────────────┼─────────────────────────┼───────────────────────────────────────┤
     │ Incremental builds         │ Only Option A           │ Current approach re-checks everything │
     └────────────────────────────┴─────────────────────────┴───────────────────────────────────────┘
     Surface: 13 tsconfig.json files + root tsconfig.json (if added)

     Leverage: Medium (build speed for large codebases, but current approach is simpler)

     ---
     5. Toolchain & Infrastructure (TS Configuration)

DONE
5a. Finding: target: "ES2022" and lib: ["ES2022"] are behind the runtime

     What exists:
     The base tsconfig at /Users/joel/Dev/exitbook/packages/tsconfig/tsconfig.json (lines 3-5) sets target: "ES2022" and lib: ["ES2022"]. The project requires Node.js >= 23 (root package.json, line
     66), and tsup targets node23 (line 7 of apps/cli/tsup.config.ts). The codebase uses using declarations (found in 117 files across packages), which is an ES2024+ / TC39 Stage 3 feature.

     Why it's a problem:
     target: "ES2022" tells TypeScript to downlevel syntax to ES2022. This means:
     - using/await using (Explicit Resource Management) would need downleveling, though in practice with noEmit + tsx, the runtime (Node 23) handles it natively.
     - New ES2023/ES2024 APIs (Array.findLast, Object.groupBy, Promise.withResolvers, Set methods, etc.) are not included in lib: ["ES2022"], so TypeScript does not recognize them even though Node 23
     supports them.
     - The mismatch between target: "ES2022" in tsconfig and target: "node23" in tsup creates a confusing dual standard.

     What V2 should do:
     Update the base tsconfig to target: "ES2024" and lib: ["ES2024"] (or "ESNext" if the team prefers to track the latest). This aligns with the Node 23 runtime requirement and unlocks type awarenes
      for modern APIs.

     Needs coverage:

     ┌────────────────────────────────────┬─────────────────────────────────────────────┬───────────────────┐
     │         Current capability         │           Covered by replacement?           │       Notes       │
     ├────────────────────────────────────┼─────────────────────────────────────────────┼───────────────────┤
     │ ES2022 syntax emit                 │ Yes (ES2024 is superset)                    │                   │
     ├────────────────────────────────────┼─────────────────────────────────────────────┼───────────────────┤
     │ ES2022 lib types                   │ Yes (ES2024 includes ES2022)                │                   │
     ├────────────────────────────────────┼─────────────────────────────────────────────┼───────────────────┤
     │ Node 23 API types                  │ Improved (ES2024 adds Array.findLast, etc.) │ Currently missing │
     ├────────────────────────────────────┼─────────────────────────────────────────────┼───────────────────┤
     │ Explicit Resource Management types │ Improved                                    │                   │
     └────────────────────────────────────┴─────────────────────────────────────────────┴───────────────────┘
     Surface: 1 file (packages/tsconfig/tsconfig.json), affects all 13 packages

     Leverage: High (unlocks modern API types, aligns target with runtime, eliminates mismatch)

     ---
     5b. Finding: verbatimModuleSyntax not enabled (modern replacement for isolatedModules)

DONE
What exists:
The base tsconfig enables isolatedModules: true (line 11). verbatimModuleSyntax is not set anywhere. The codebase has 1,271 import type statements alongside the consistent-type-imports ESLint
rule, showing the team already uses type-only imports.

     Why it's a problem:
     verbatimModuleSyntax (TS 5.4+) is the modern successor to isolatedModules. It provides stronger guarantees:
     - Enforces that import type is used for type-only imports at the TypeScript level (not just ESLint).
     - Ensures import/export syntax is preserved exactly as written (no silent elision).
     - Replaces isolatedModules, preserveValueImports (deprecated), and the ESLint consistent-type-imports rule with a single compiler flag.

     Since the project already enforces consistent-type-imports via ESLint and uses noEmit everywhere, the migration cost is low.

     What V2 should do:
     Enable verbatimModuleSyntax: true and remove isolatedModules: true (it becomes implied). This also allows potentially removing the @typescript-eslint/consistent-type-imports ESLint rule since th
      compiler enforces it natively.

     Needs coverage:
     ┌──────────────────────────────┬────────────────────────────┬────────────────────────┐
     │      Current capability      │  Covered by replacement?   │         Notes          │
     ├──────────────────────────────┼────────────────────────────┼────────────────────────┤
     │ Isolated module checking     │ Yes (implied)              │                        │
     ├──────────────────────────────┼────────────────────────────┼────────────────────────┤
     │ Type-only import enforcement │ Yes (compiler-level)       │ Stronger than ESLint   │
     ├──────────────────────────────┼────────────────────────────┼────────────────────────┤
     │ ESM/CJS syntax preservation  │ Yes (that's what it does)  │                        │
     ├──────────────────────────────┼────────────────────────────┼────────────────────────┤
     │ import type usage            │ Yes (enforced by compiler) │ Can remove ESLint rule │
     └──────────────────────────────┴────────────────────────────┴────────────────────────┘
     Surface: 1 tsconfig file, potentially 1 ESLint rule removal, ~1,271 existing import type statements (already compliant)

     Leverage: High (compiler-level enforcement > ESLint-level, removes redundant tooling)

     ---
     5c. Finding: noPropertyAccessFromIndexSignature not enabled

DONE
What exists:
The base tsconfig enables several strict options (exactOptionalPropertyTypes, noUncheckedIndexedAccess) but does not enable noPropertyAccessFromIndexSignature.

     Why it's a problem:
     With noUncheckedIndexedAccess enabled, bracket access (obj["key"]) correctly returns T | undefined. But dot access (obj.key) on index signatures still returns T without the | undefined, creating
     an inconsistency. For a financial system where data integrity matters, this is a gap in type safety.

     What V2 should do:
     Enable noPropertyAccessFromIndexSignature: true in the base tsconfig. This forces bracket notation for index signatures, making the | undefined return type visible and consistent with
     noUncheckedIndexedAccess.

     Needs coverage:

     ┌─────────────────────────────┬─────────────────────────┬──────────────────────────────┐
     │     Current capability      │ Covered by replacement? │            Notes             │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────┤
     │ Index signature type safety │ Improved                │ Closes gap in current config │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────┤
     │ Dot access on known props   │ Unaffected              │ Only index sigs are affected │
     └─────────────────────────────┴─────────────────────────┴──────────────────────────────┘
     Surface: 1 file, unknown number of call-sites (may require bracket notation changes)

     Leverage: Medium (type safety for financial data, complements existing strict options)

     ---
     5d. Finding: typescript as devDependency in every package

DONE
What exists:
Every package (12 packages + 1 app = 13 total) declares "typescript": "^5.9.3" in its devDependencies. The versions are currently aligned but maintained independently.

     Why it's a problem:
     In a pnpm workspace, hoisted dependencies mean all packages share the same TypeScript installation anyway. Declaring it 13 times creates 13 places to update when bumping TS versions. If versions
     drift (e.g., one package gets ^5.10.0 while others stay at ^5.9.3), it creates confusion about which version is active.

     What V2 should do:
     Move typescript to the root package.json devDependencies and remove it from individual packages. Use pnpm's workspace protocol or catalog feature to ensure a single version. The tsconfig shared
     package already provides configuration; it should also centralize the TS dependency.

     Needs coverage:

     ┌─────────────────────────────┬───────────────────────────────────┬───────┐
     │     Current capability      │      Covered by replacement?      │ Notes │
     ├─────────────────────────────┼───────────────────────────────────┼───────┤
     │ Per-package TS availability │ Yes (hoisted from root)           │       │
     ├─────────────────────────────┼───────────────────────────────────┼───────┤
     │ Version pinning             │ Improved (single source of truth) │       │
     ├─────────────────────────────┼───────────────────────────────────┼───────┤
     │ IDE resolution              │ Yes (pnpm resolves from root)     │       │
     └─────────────────────────────┴───────────────────────────────────┴───────┘
     Surface: 13 package.json files, 1 root package.json

     Leverage: Medium (reduces version management burden, prevents drift)

     ---
     5e. Finding: @types/node duplicated across all packages

DONE
What exists:
All 11 packages (excluding tsconfig and events) declare "@types/node": "^25.0.10" in devDependencies. Similar to TypeScript itself, this is maintained in 11 separate locations.

     Why it's a problem:
     Same as the TypeScript duplication: 11 places to update, risk of version drift. Modern Node.js (23+) ships with built-in type declarations when using --experimental-strip-types, but since the
     project uses tsx/tsup, @types/node is still needed.

     What V2 should do:
     Move @types/node to the root package.json devDependencies.

     Surface: 11 package.json files

     Leverage: Low (hygiene, reduces update burden)

     ---
     6. File & Code Organization (TS-specific)

     6a. Finding: CLI tsconfig includes JSX config for React (Ink) but only 1 .tsx file exists

DONE
What exists:
/Users/joel/Dev/exitbook/apps/cli/tsconfig.json (lines 6-8) configures:
"jsx": "react",
"jsxFactory": "React.createElement",
"jsxFragmentFactory": "React.Fragment"

     There is exactly one .tsx file: /Users/joel/Dev/exitbook/apps/cli/src/ui/dashboard/dashboard-components.tsx (992 lines).

     Why it's a problem:
     The JSX configuration is correct for the Ink-based UI. However, "jsx": "react" uses the legacy JSX transform (explicit React.createElement calls). React 17+ and Ink 4+ support the new JSX
     transform ("jsx": "react-jsx"), which:
     - Does not require import React from 'react' at the top of every JSX file.
     - Produces slightly smaller output.
     - Is the recommended transform for new projects.

     The current file does import React from 'react' (line 9), which is only needed with the legacy transform.

     What V2 should do:
     Update to "jsx": "react-jsx" and remove the jsxFactory/jsxFragmentFactory options (they are not needed with the new transform). Remove the import React from 'react' line from
     dashboard-components.tsx (keep only the named imports from react that are actually used, like React.FC, React.ReactNode -- though these can be imported directly).

     Needs coverage:
     ┌────────────────────┬─────────────────────────┬────────────────────────────────┐
     │ Current capability │ Covered by replacement? │             Notes              │
     ├────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ JSX compilation    │ Yes                     │ react-jsx is the standard      │
     ├────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ React type usage   │ Yes                     │ Import FC, ReactNode directly  │
     ├────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ Ink compatibility  │ Yes                     │ Ink supports new JSX transform │
     └────────────────────┴─────────────────────────┴────────────────────────────────┘
     Surface: 1 tsconfig, 1 .tsx file

     Leverage: Low (minor modernization, single file)

     ---
     6b. Finding: Inconsistent include presence across tsconfigs

     What exists:
     Some package tsconfigs have "include": ["src"] while others have no include at all:

     - With include: core, data, logger, http, env, blockchain-providers, exchange-providers, price-providers, accounting
     - Without include: CLI app (apps/cli), events (has "include": ["src/**/*"])

     When include is absent, TypeScript defaults to including all .ts/.tsx files in the project directory and subdirectories. For the CLI app, this means it could accidentally type-check files in
     data/, dist/, or other non-source directories.

     Why it's a problem:
     Inconsistency means some packages check only src/ while others check everything. For the CLI app, which has a data/ directory for SQLite databases and a dist/ directory for builds, this could
     pick up stray .ts files.

     What V2 should do:
     Add "include": ["src"] to all tsconfigs that lack it (CLI, events). Standardize on "include": ["src"] (not "include": ["src/**/*"] which is equivalent but inconsistently formatted).

     Surface: 2-3 tsconfig files

     Leverage: Low (consistency)

     ---
     7. Error Handling & Observability (TS-specific)

     7a. Finding: ESLint disables no-unsafe-* rules entirely for Effect-TS files

     What exists:
     In /Users/joel/Dev/exitbook/eslint.config.js (lines 136-159), the Effect-TS configuration block disables all four no-unsafe-* rules:
     '@typescript-eslint/no-unsafe-assignment': 'off',
     '@typescript-eslint/no-unsafe-call': 'off',
     '@typescript-eslint/no-unsafe-member-access': 'off',
     '@typescript-eslint/no-unsafe-return': 'off',

     This applies to packages/core/**/src/**/*.{ts,tsx}.

     Why it's a problem:
     The core package is the domain layer -- the most critical package in a financial system. Disabling all any-safety rules here means that any types can flow through the core domain without type
     checking catching them. The comment says "Allow unsafe operations for database/external library integration" but core should not have database or external library integration per the project's
     own architecture rules (confirmed by the layer boundary ESLint rules on lines 189-238).

     What V2 should do:
     Re-evaluate whether the Effect-TS code in core actually needs all four rules disabled. If specific functions need any (e.g., Zod schema inference), use targeted eslint-disable comments with
     required descriptions (the eslint-comments/require-description rule already enforces this). Do not blanket-disable type safety for the entire core package.

     Needs coverage:
     ┌─────────────────────────┬─────────────────────────┬────────────────────────┐
     │   Current capability    │ Covered by replacement? │         Notes          │
     ├─────────────────────────┼─────────────────────────┼────────────────────────┤
     │ Effect-TS compatibility │ Yes (targeted disables) │ More granular          │
     ├─────────────────────────┼─────────────────────────┼────────────────────────┤
     │ Type safety in core     │ Improved                │ Currently a blind spot │
     └─────────────────────────┴─────────────────────────┴────────────────────────┘
     Surface: 1 ESLint config block, all files in packages/core/src/

     Leverage: High (type safety gap in the most critical package)

     ---
     V2 Decision Summary
     ┌──────┬────────────────────────────────────────────────────────────────┬────────────────────┬──────────┬──────────────────────────────────────────────────────────────────────────────────┐
     │ Rank │                             Change                             │     Dimension      │ Leverage │                                One-line Rationale                                │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 1    │ Upgrade target/lib to ES2024                                   │ Toolchain (5a)     │ High     │ Aligns type system with Node 23 runtime; unlocks modern API types                │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 2    │ Enable verbatimModuleSyntax                                    │ Toolchain (5b)     │ High     │ Compiler-level type-import enforcement replaces ESLint rule; stronger guarantees │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 3    │ Remove experimentalDecorators, use plain function calls        │ Patterns (3a)      │ High     │ Eliminates legacy flag from 13 packages for 29 simple call-sites                 │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 4    │ Remove cross-package include paths                             │ Architecture (2a)  │ High     │ Restores package boundary integrity; fixes layering violation                    │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 5    │ Re-enable no-unsafe-* in core package                          │ Observability (7a) │ High     │ Closes type-safety blind spot in financial domain layer                          │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 6    │ Enable noPropertyAccessFromIndexSignature                      │ Toolchain (5c)     │ Medium   │ Completes strict type safety for indexed access patterns                         │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 7    │ Standardize import extensions (.js or .ts)                     │ Patterns (3b)      │ Medium   │ Eliminates 10% inconsistency across ~1,200 imports                               │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 8    │ Centralize typescript in root package.json                     │ Toolchain (5d)     │ Medium   │ Single version source for 13 packages                                            │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 9    │ Remove reflect-metadata                                        │ Dependencies (1c)  │ Medium   │ Removes misleading dependency with zero actual usage                             │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 10   │ Remove redundant allowSyntheticDefaultImports                  │ Patterns (3c)      │ Low      │ Config noise reduction                                                           │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 11   │ Remove redundant strictNullChecks / useUnknownInCatchVariables │ Patterns (3d)      │ Low      │ Config noise reduction                                                           │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 12   │ Fix events tsconfig contradiction                              │ Architecture (2b)  │ Low      │ Align emit config with build script                                              │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 13   │ Remove stale devDeps from logger                               │ Dependencies (1b)  │ Low      │ Dead dependency cleanup                                                          │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 14   │ Remove unused @trivago/prettier-plugin-sort-imports            │ Dependencies (1a)  │ Low      │ Dead dependency cleanup                                                          │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 15   │ Update JSX transform to react-jsx                              │ Organization (6a)  │ Low      │ Minor modernization for 1 file                                                   │
     ├──────┼────────────────────────────────────────────────────────────────┼────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────┤
     │ 16   │ Standardize include in all tsconfigs                           │ Organization (6b)  │ Low      │ Consistency                                                                      │
     └──────┴────────────────────────────────────────────────────────────────┴────────────────────┴──────────┴──────────────────────────────────────────────────────────────────────────────────┘
     ---
     What V2 Keeps

     The following TypeScript configuration choices have earned their place and should carry forward unchanged:

     - strict: true -- The project correctly enables the full strict family. This is the right call for a financial system.
     - exactOptionalPropertyTypes: true -- A rare and valuable strict option that most projects skip. Correctly enforced here per CLAUDE.md convention (| undefined on optional properties).
     - noUncheckedIndexedAccess: true -- Another above-and-beyond strict option. Correctly prevents silent undefined from index access.
     - module: "NodeNext" + moduleResolution: "NodeNext" -- Correct for an ESM-first Node.js project. No reason to change.
     - skipLibCheck: true -- Pragmatic choice that avoids type-checking .d.ts files from dependencies, reducing build time without sacrificing project code safety.
     - forceConsistentCasingInFileNames: true -- Prevents cross-platform casing bugs. Keep.
     - Shared tsconfig package -- The pattern of a workspace package providing base tsconfig is clean and well-executed. All 13 packages extend it with minimal per-package overrides.
     - noEmit + raw .ts consumption -- For a private monorepo that never publishes packages, this is the simplest approach. No .d.ts management, no build output to synchronize. The tsx runtime handle
      execution directly.
     - consistent-type-imports ESLint rule -- Well-adopted (1,271 type imports vs 2,189 value imports). Should be kept even if verbatimModuleSyntax is adopted (belt and suspenders for the transition
     period).
     - Type-aware ESLint with projectService -- Using projectService: true instead of manually specifying project paths is the modern, correct approach for monorepo type-aware linting.
     - Layer boundary enforcement via ESLint -- The import/no-restricted-paths rules in /Users/joel/Dev/exitbook/eslint.config.js (lines 188-238) enforcing core purity and ingestion layer boundaries
     are architecturally sound and should carry forward.
