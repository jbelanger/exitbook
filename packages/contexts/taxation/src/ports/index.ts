// Effect "ports" (service tags/interfaces) the app/core depend on.
// Implementations live under adapters/.
export interface RepositoryPort { /* define methods */ }
export interface MessageBusPort { /* define methods */ }
// export const RepositoryTag = Symbol.for("RepositoryPort") as unique symbol;
