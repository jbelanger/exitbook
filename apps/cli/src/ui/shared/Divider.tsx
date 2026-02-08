import { Text } from 'ink';
import type { FC } from 'react';

/**
 * Full-width dim horizontal divider
 */
export const Divider: FC<{ width: number }> = ({ width }) => {
  const line = '─'.repeat(width);
  return <Text dimColor>{line}</Text>;
};
