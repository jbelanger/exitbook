import * as p from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCancellation, isCancelled } from '../prompts.ts';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

describe('prompts utilities', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    }) as never;
    vi.clearAllMocks();
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  describe('isCancelled', () => {
    it('should return true when value is a cancel symbol', () => {
      const cancelSymbol = Symbol('cancel');
      vi.mocked(p.isCancel).mockReturnValue(true);

      const result = isCancelled(cancelSymbol);

      expect(result).toBe(true);
      expect(p.isCancel).toHaveBeenCalledWith(cancelSymbol);
    });

    it('should return false when value is not a cancel symbol', () => {
      vi.mocked(p.isCancel).mockReturnValue(false);

      const result = isCancelled('some value');

      expect(result).toBe(false);
      expect(p.isCancel).toHaveBeenCalledWith('some value');
    });

    it('should work with various value types', () => {
      vi.mocked(p.isCancel).mockReturnValue(false);

      expect(isCancelled('string')).toBe(false);
      expect(isCancelled(123)).toBe(false);
      expect(isCancelled({ key: 'value' })).toBe(false);
    });
  });

  describe('handleCancellation', () => {
    it('should call p.cancel with default message and exit', () => {
      expect(() => handleCancellation()).toThrow('process.exit called');

      expect(p.cancel).toHaveBeenCalledWith('Operation cancelled');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should call p.cancel with custom message and exit', () => {
      expect(() => handleCancellation('Custom cancellation message')).toThrow('process.exit called');

      expect(p.cancel).toHaveBeenCalledWith('Custom cancellation message');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });
});
