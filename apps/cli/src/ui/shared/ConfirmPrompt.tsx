/**
 * Ink-based confirmation prompt component
 */

import { Box, Text, useInput } from 'ink';
import { useState, type FC } from 'react';

export interface ConfirmPromptProps {
  /** Question to ask the user */
  message: string;
  /** Initial/default value */
  initialValue?: boolean;
  /** Callback when user confirms or cancels */
  onSubmit: (value: boolean) => void;
  /** Callback when user cancels (Ctrl+C or Esc) */
  onCancel?: () => void;
}

/**
 * Confirmation prompt - Yes/No question
 */
export const ConfirmPrompt: FC<ConfirmPromptProps> = ({ message, initialValue = true, onSubmit, onCancel }) => {
  const [value, setValue] = useState(initialValue);

  useInput((input, key) => {
    // Cancel on Ctrl+C or Esc
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.();
      return;
    }

    // Submit on Enter
    if (key.return) {
      onSubmit(value);
      return;
    }

    // Toggle on Y/N or arrow keys
    if (input.toLowerCase() === 'y') {
      setValue(true);
    } else if (input.toLowerCase() === 'n') {
      setValue(false);
    } else if (key.leftArrow || key.rightArrow) {
      setValue(!value);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">?</Text> {message}
      </Text>
      <Text>
        {'  '}
        {value ? (
          <>
            <Text
              bold
              color="green"
            >
              {'>'} Yes
            </Text>
            <Text dimColor> / No</Text>
          </>
        ) : (
          <>
            <Text dimColor>Yes / </Text>
            <Text
              bold
              color="green"
            >
              {'>'} No
            </Text>
          </>
        )}
      </Text>
    </Box>
  );
};
