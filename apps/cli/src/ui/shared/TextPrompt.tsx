/**
 * Ink-based text input prompt component
 */

import { Box, Text, useInput } from 'ink';
import { useState, type FC } from 'react';

export interface TextPromptProps {
  /** Question to ask the user */
  message: string;
  /** Placeholder text */
  placeholder?: string;
  /** Initial value */
  initialValue?: string;
  /** Validation function - returns error message or undefined if valid */
  validate?: (value: string) => string | undefined;
  /** Callback when user submits valid input */
  onSubmit: (value: string) => void;
  /** Callback when user cancels (Ctrl+C or Esc) */
  onCancel?: () => void;
}

/**
 * Text input prompt with validation
 */
export const TextPrompt: FC<TextPromptProps> = ({
  message,
  placeholder,
  initialValue = '',
  validate,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | undefined>();

  useInput((input, key) => {
    // Cancel on Ctrl+C or Esc
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.();
      return;
    }

    // Submit on Enter
    if (key.return) {
      // Use placeholder as default if value is empty
      const finalValue = value || placeholder || '';

      // Validate
      if (validate) {
        const validationError = validate(finalValue);
        if (validationError) {
          setError(validationError);
          return;
        }
      }

      setError(undefined);
      onSubmit(finalValue);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setValue(value.slice(0, -1));
      setError(undefined);
      return;
    }

    // Regular character input
    if (!key.ctrl && !key.meta && input) {
      setValue(value + input);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">?</Text> {message}
      </Text>
      <Text>
        {'  '}
        <Text color="green">{'>'}</Text> {value || <Text dimColor>{placeholder}</Text>}
        <Text color="cyan">_</Text>
      </Text>
      {error && (
        <Text color="red">
          {'  '}⚠ {error}
        </Text>
      )}
    </Box>
  );
};
