export type PresentationMode = 'json' | 'text' | 'text-progress' | 'tui';

export type CommandIntent = 'browse' | 'workflow' | 'mutate' | 'destructive-review' | 'export';

export type CommandEntrypointRole = 'snapshot' | 'explorer' | 'workflow' | 'mutate' | 'export' | 'destructive-review';

export function toCliOutputFormat(mode: PresentationMode): 'json' | 'text' {
  return mode === 'json' ? 'json' : 'text';
}
