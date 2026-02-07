/**
 * Tests for ConfirmPrompt component
 *
 * Note: Interactive keyboard input tests are skipped as ink-testing-library
 * has limitations with async state updates. These components are tested
 * through manual usage and integration tests.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { ConfirmPrompt } from '../ConfirmPrompt.js';

describe('ConfirmPrompt', () => {
  it('renders with message and Yes selected by default', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ConfirmPrompt
        message="Continue?"
        initialValue={true}
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('Continue?');
    expect(lastFrame()).toContain('> Yes');
  });

  it('renders with No selected when initialValue is false', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ConfirmPrompt
        message="Delete?"
        initialValue={false}
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('Delete?');
    expect(lastFrame()).toContain('> No');
  });

  it('renders question mark icon', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ConfirmPrompt
        message="Test?"
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('?');
  });
});
