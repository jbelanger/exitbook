/**
 * Orchestrates sequential prompt flows using Ink components
 */

import { Box, Text } from 'ink';
import React, { useState, type FC } from 'react';

import { ConfirmPrompt, type ConfirmPromptProps } from './ConfirmPrompt.js';
import { TextPrompt, type TextPromptProps } from './TextPrompt.js';

/** Prompt step types */
export type PromptStep =
  | { props: Omit<ConfirmPromptProps, 'onSubmit' | 'onCancel'>; type: 'confirm'; }
  | { props: Omit<TextPromptProps, 'onSubmit' | 'onCancel'>; type: 'text'; };

export interface PromptFlowProps {
  /** Title shown at the top */
  title?: string;
  /** Sequential prompt steps */
  steps: PromptStep[];
  /** Callback when all prompts complete successfully */
  onComplete: (answers: (boolean | string)[]) => void;
  /** Callback when user cancels */
  onCancel: () => void;
}

/**
 * Orchestrates a sequence of prompts
 */
export const PromptFlow: FC<PromptFlowProps> = ({ title, steps, onComplete, onCancel }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [answers, setAnswers] = useState<(boolean | string)[]>([]);

  const currentStep = steps[currentStepIndex];

  if (!currentStep) {
    // All steps complete
    return null;
  }

  const handleSubmit = (answer: boolean | string): void => {
    const newAnswers = [...answers, answer];
    setAnswers(newAnswers);

    if (currentStepIndex + 1 >= steps.length) {
      // All steps complete
      onComplete(newAnswers);
    } else {
      // Move to next step
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text> </Text>
          <Text bold>{title}</Text>
          <Text> </Text>
        </>
      )}
      {currentStep.type === 'confirm' && (
        <ConfirmPrompt
          {...currentStep.props}
          onSubmit={handleSubmit}
          onCancel={onCancel}
        />
      )}
      {currentStep.type === 'text' && (
        <TextPrompt
          {...currentStep.props}
          onSubmit={handleSubmit}
          onCancel={onCancel}
        />
      )}
    </Box>
  );
};
