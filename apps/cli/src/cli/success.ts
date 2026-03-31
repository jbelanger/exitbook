import pc from 'picocolors';

export function formatSuccessLine(message: string): string {
  return `${pc.green('✓')} ${message}`;
}
