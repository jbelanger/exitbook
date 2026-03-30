export type PresentationMode = 'json' | 'static' | 'text-progress' | 'tui';

export function toCliOutputFormat(mode: PresentationMode): 'json' | 'text' {
  return mode === 'json' ? 'json' : 'text';
}
