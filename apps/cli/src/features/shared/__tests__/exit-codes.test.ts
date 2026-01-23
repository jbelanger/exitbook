import { describe, expect, it } from 'vitest';

import { ExitCodes } from '../exit-codes.js';

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
});
