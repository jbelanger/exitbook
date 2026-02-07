/**
 * Status icon component - visual indicators for operation states
 */

import { Text } from 'ink';
import Spinner from 'ink-spinner';
import type { FC, ReactNode } from 'react';

export type OperationStatus = 'active' | 'completed' | 'warning' | 'failed';

interface StatusIconProps {
  status: OperationStatus;
}

/**
 * StatusIcon component - renders status indicators with appropriate colors
 *
 * Signal tier icons:
 * - active: cyan spinner (⠋)
 * - completed: green checkmark (✓)
 * - warning/failed: yellow warning (⚠)
 */
export const StatusIcon: FC<StatusIconProps> = ({ status }) => {
  if (status === 'active') {
    return (
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
    );
  }
  if (status === 'failed' || status === 'warning') {
    return <Text color="yellow">⚠</Text>;
  }
  return <Text color="green">✓</Text>;
};

/**
 * Helper function to get status icon as ReactNode (for inline use)
 */
export function statusIcon(status: OperationStatus): ReactNode {
  if (status === 'active') {
    return (
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
    );
  }
  if (status === 'failed' || status === 'warning') {
    return <Text color="yellow">⚠</Text>;
  }
  return <Text color="green">✓</Text>;
}
