import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCodes, exitWithCode } from '../exit-codes.js';

describe('exit-codes', () => {
  describe('ExitCodes', () => {
    it('should define SUCCESS as 0', () => {
      expect(ExitCodes.SUCCESS).toBe(0);
    });

    it('should define error codes', () => {
      expect(ExitCodes.GENERAL_ERROR).toBe(1);
      expect(ExitCodes.INVALID_ARGS).toBe(2);
      expect(ExitCodes.AUTHENTICATION_ERROR).toBe(3);
      expect(ExitCodes.NOT_FOUND).toBe(4);
      expect(ExitCodes.RATE_LIMIT).toBe(5);
      expect(ExitCodes.NETWORK_ERROR).toBe(6);
      expect(ExitCodes.DATABASE_ERROR).toBe(7);
      expect(ExitCodes.VALIDATION_ERROR).toBe(8);
      expect(ExitCodes.CANCELLED).toBe(9);
      expect(ExitCodes.TIMEOUT).toBe(10);
      expect(ExitCodes.CONFIG_ERROR).toBe(11);
      expect(ExitCodes.PERMISSION_DENIED).toBe(13);
    });

    it('should have unique exit codes', () => {
      const codes = Object.values(ExitCodes);
      const uniqueCodes = new Set(codes);
      expect(codes.length).toBe(uniqueCodes.size);
    });
  });

  describe('exitWithCode', () => {
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock process.exit to prevent actual process termination
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
        throw new Error('process.exit called');
      }) as never;
    });

    afterEach(() => {
      processExitSpy.mockRestore();
    });

    it('should call process.exit with the provided code', () => {
      expect(() => exitWithCode(ExitCodes.GENERAL_ERROR)).toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit with SUCCESS code', () => {
      expect(() => exitWithCode(ExitCodes.SUCCESS)).toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should call process.exit with specific error codes', () => {
      expect(() => exitWithCode(ExitCodes.INVALID_ARGS)).toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(2);

      processExitSpy.mockClear();

      expect(() => exitWithCode(ExitCodes.NOT_FOUND)).toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(4);
    });
  });
});
