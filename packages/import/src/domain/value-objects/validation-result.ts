/**
 * Validation result for individual rules
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly message: string;
  readonly rule: string;
  readonly violations?: string[];
}
