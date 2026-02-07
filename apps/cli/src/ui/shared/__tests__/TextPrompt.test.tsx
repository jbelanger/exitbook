/**
 * Tests for TextPrompt component
 *
 * Note: Interactive keyboard input tests are skipped as ink-testing-library
 * has limitations with async state updates. These components are tested
 * through manual usage and integration tests.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { TextPrompt } from '../TextPrompt.js';

describe('TextPrompt', () => {
  it('renders with message and placeholder', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <TextPrompt
        message="Enter name:"
        placeholder="John Doe"
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('Enter name:');
    expect(lastFrame()).toContain('John Doe');
  });

  it('renders with question mark icon and cursor', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <TextPrompt
        message="Enter value:"
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('?');
    expect(lastFrame()).toContain('>');
    expect(lastFrame()).toContain('_'); // Cursor
  });

  it('renders with initial value', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <TextPrompt
        message="Enter value:"
        initialValue="test"
        onSubmit={onSubmit}
      />
    );

    expect(lastFrame()).toContain('test');
  });
});
