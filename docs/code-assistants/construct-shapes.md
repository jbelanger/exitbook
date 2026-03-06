# Construct Shapes

Match the construct to the shape:

| Shape                         | Use                         | Example                                              |
| ----------------------------- | --------------------------- | ---------------------------------------------------- |
| State + methods               | Class                       | `TransactionRepository`, `PriceService`, API clients |
| Pure transform                | Function                    | `toUniversalTransaction()`, `buildMovementRows()`    |
| Config → single function      | Factory/closure             | `createRetryWrapper(config)` returning one function  |
| Bag of related pure functions | Named exports from a module | `cost-basis-utils.ts`                                |

**Never use closure factories (`createFooQueries(db)` returning an object of methods) as a substitute for classes** — if it captures state and exposes multiple methods, it's a class.
