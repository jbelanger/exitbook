/**
 * Ink-based select prompt component
 */

import { Box, Text, useInput } from 'ink';
import { useState, type FC } from 'react';

export interface SelectOption<T extends string = string> {
  /** Display text */
  label: string;
  /** Value returned on submit */
  value: T;
  /** Hint text shown dimmed after the label */
  hint?: string | undefined;
  /** Disabled options cannot be selected */
  disabled?: boolean | undefined;
}

export interface SelectPromptProps<T extends string = string> {
  /** Question to ask the user */
  message: string;
  /** Available options */
  options: SelectOption<T>[];
  /** Initial selected value */
  initialValue?: T | undefined;
  /** Callback when user selects an option */
  onSubmit: (value: T) => void;
  /** Callback when user cancels (Ctrl+C or Esc) */
  onCancel?: (() => void) | undefined;
}

/**
 * Find the next enabled option index in a given direction.
 */
function findNextEnabled<T extends string>(options: SelectOption<T>[], current: number, direction: 1 | -1): number {
  const len = options.length;
  let next = (current + direction + len) % len;
  // Wrap around at most once
  const start = next;
  do {
    if (!options[next]?.disabled) return next;
    next = (next + direction + len) % len;
  } while (next !== start);
  return current; // All disabled — stay put
}

/**
 * Select prompt — choose one option from a list
 */
export const SelectPrompt: FC<SelectPromptProps> = ({ message, options, initialValue, onSubmit, onCancel }) => {
  const initialIndex = initialValue
    ? Math.max(
        0,
        options.findIndex((o) => o.value === initialValue)
      )
    : 0;
  // Skip to first enabled if initial is disabled
  const safeInitial = options[initialIndex]?.disabled ? findNextEnabled(options, initialIndex, 1) : initialIndex;
  const [selectedIndex, setSelectedIndex] = useState(safeInitial);

  useInput((input, key) => {
    // Cancel on Ctrl+C or Esc
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.();
      return;
    }

    // Submit on Enter
    if (key.return) {
      const option = options[selectedIndex];
      if (option && !option.disabled) {
        onSubmit(option.value);
      }
      return;
    }

    // Navigate up
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => findNextEnabled(options, prev, -1));
      return;
    }

    // Navigate down
    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => findNextEnabled(options, prev, 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">?</Text> {message}
      </Text>
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = !!option.disabled;

        return (
          <Text key={option.value}>
            {'  '}
            {isSelected ? (
              <Text
                bold
                color="green"
              >
                {'>'}{' '}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text
              dimColor={isDisabled}
              bold={isSelected && !isDisabled}
            >
              {option.label}
            </Text>
            {option.hint && <Text dimColor> ({option.hint})</Text>}
          </Text>
        );
      })}
    </Box>
  );
};
