// Thin orchestration (commands/queries/sagas) that composes core with ports.
// Keep logic here minimal; push rules into core/services.
export * from './commands';
export * from './queries';
export * from './sagas';
