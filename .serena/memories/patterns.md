# exitbook — Code Patterns & Conventions

## Result Type (neverthrow)

- All fallible functions return `Result<T, Error>` — no throws
- `errAsync`/`okAsync` are valid from `async` methods typed as `Promise<Result<...>>`
- Chain with `.map()`, `.mapErr()`, `.andThen()`; propagate errors upward

## Zod Schemas

- Core schemas: `packages/core/src/schemas/`
- Feature-specific: `*.schemas.ts` co-located with feature
- Types via `type Foo = z.infer<typeof FooSchema>`

## Logging (Pino)

```typescript
import { getLogger } from '@exitbook/logger';
const logger = getLogger('component-name');
logger.info('message');
logger.error({ error }, 'error message');
// Use logger.warn() liberally for edge cases / unexpected conditions
```

## Decimal.js

```typescript
import { Decimal } from 'decimal.js';
amount.toFixed(); // for strings — NOT .toString() (scientific notation)
```

## Functional Core, Imperative Shell

- Pure business logic in `*-utils.ts` (no side effects)
- Classes for resource management (DB, API clients)
- Factory functions for stateless wrappers
- Test pure functions without mocks; test classes with mocked deps

## Organization

- **Vertical slices**: feature directories contain importer + processor + schemas + tests
- **No hardcoded lists**: use registries/metadata for dynamic discovery
- **Clean breaks**: no backward-compat shims when refactoring
- **No silent errors**: always log warnings for edge cases; propagate via Result

## TypeScript

- `exactOptionalPropertyTypes`: add `| undefined` to optional properties
- ESM modules throughout
- New tables/fields go in `001_initial_schema.ts` (DB dropped in dev, not versioned)

## File Naming

- Feature utilities: `*-utils.ts`
- Schemas: `*.schemas.ts`
- Tests: `*.test.ts` co-located with source
