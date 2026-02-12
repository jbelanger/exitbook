/**
 * Clear view controller tests
 */

import { describe, expect, it } from 'vitest';

import { clearViewReducer, type ClearViewAction } from '../components/clear-view-controller.js';
import {
  buildCategoryItems,
  calculateTotalToDelete,
  createClearViewState,
  getActivePreview,
} from '../components/clear-view-state.js';

// Mock previewWithoutRaw has zero raw counts (matching actual service behavior)
const mockPreviewWithoutRaw = {
  transactions: 100,
  links: 50,
  accounts: 0,
  sessions: 0,
  rawData: 0,
};

// Mock previewWithRaw has actual raw counts
const mockPreviewWithRaw = {
  transactions: 100,
  links: 50,
  accounts: 3,
  sessions: 2,
  rawData: 500,
};

const mockScope = {
  label: 'all accounts',
};

describe('ClearViewReducer', () => {
  describe('Navigation actions', () => {
    it('should navigate up', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const initialState = { ...state, selectedIndex: 2 };

      const action: ClearViewAction = { type: 'NAVIGATE_UP', visibleRows: 10 };
      const newState = clearViewReducer(initialState, action);

      expect(newState.selectedIndex).toBe(1);
    });

    it('should navigate down', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);

      const action: ClearViewAction = { type: 'NAVIGATE_DOWN', visibleRows: 10 };
      const newState = clearViewReducer(state, action);

      expect(newState.selectedIndex).toBe(1);
    });

    it('should handle home navigation', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const initialState = { ...state, selectedIndex: 5 };

      const action: ClearViewAction = { type: 'HOME' };
      const newState = clearViewReducer(initialState, action);

      expect(newState.selectedIndex).toBe(0);
      expect(newState.scrollOffset).toBe(0);
    });

    it('should handle end navigation', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);

      const action: ClearViewAction = { type: 'END', visibleRows: 10 };
      const newState = clearViewReducer(state, action);

      expect(newState.selectedIndex).toBe(8); // 9 items total (0-8)
    });

    it('should block navigation during execution', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const executingState = { ...state, phase: 'executing' as const };

      const action: ClearViewAction = { type: 'NAVIGATE_DOWN', visibleRows: 10 };
      const newState = clearViewReducer(executingState, action);

      expect(newState.selectedIndex).toBe(0); // No change
    });
  });

  describe('Toggle include-raw', () => {
    it('should toggle includeRaw in preview phase', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);

      const action: ClearViewAction = { type: 'TOGGLE_INCLUDE_RAW' };
      const newState = clearViewReducer(state, action);

      expect(newState.includeRaw).toBe(true);
    });

    it('should not toggle includeRaw outside preview phase', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const confirmingState = { ...state, phase: 'confirming' as const };

      const action: ClearViewAction = { type: 'TOGGLE_INCLUDE_RAW' };
      const newState = clearViewReducer(confirmingState, action);

      expect(newState.includeRaw).toBe(false); // No change
    });
  });

  describe('Confirmation flow', () => {
    it('should transition from preview to confirming on INITIATE_DELETE', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);

      const action: ClearViewAction = { type: 'INITIATE_DELETE' };
      const newState = clearViewReducer(state, action);

      expect(newState.phase).toBe('confirming');
    });

    it('should transition from confirming to executing on CONFIRM_DELETE', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const confirmingState = { ...state, phase: 'confirming' as const };

      const action: ClearViewAction = { type: 'CONFIRM_DELETE' };
      const newState = clearViewReducer(confirmingState, action);

      expect(newState.phase).toBe('executing');
    });

    it('should revert to preview on CANCEL_CONFIRM', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const confirmingState = { ...state, phase: 'confirming' as const };

      const action: ClearViewAction = { type: 'CANCEL_CONFIRM' };
      const newState = clearViewReducer(confirmingState, action);

      expect(newState.phase).toBe('preview');
    });
  });

  describe('Execution complete', () => {
    it('should transition to complete with result', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const executingState = { ...state, phase: 'executing' as const };

      const result = mockPreviewWithRaw;
      const action: ClearViewAction = { type: 'EXECUTION_COMPLETE', result };
      const newState = clearViewReducer(executingState, action);

      expect(newState.phase).toBe('complete');
      expect(newState.result).toEqual(result);
    });
  });
});

describe('State helper functions', () => {
  describe('getActivePreview', () => {
    it('should return previewWithoutRaw when includeRaw is false', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const preview = getActivePreview(state);
      expect(preview).toEqual(mockPreviewWithoutRaw);
    });

    it('should return previewWithRaw when includeRaw is true', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, true);
      const preview = getActivePreview(state);
      expect(preview).toEqual(mockPreviewWithRaw);
    });
  });

  describe('calculateTotalToDelete', () => {
    it('should exclude raw data when includeRaw is false', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const total = calculateTotalToDelete(state);

      // 100 + 50 = 150 (no accounts, sessions, rawData)
      expect(total).toBe(150);
    });

    it('should include raw data when includeRaw is true', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, true);
      const total = calculateTotalToDelete(state);

      // 100 + 50 + 3 + 2 + 500 = 655
      expect(total).toBe(655);
    });
  });

  describe('buildCategoryItems', () => {
    it('should mark processed categories as will-delete when count > 0', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const items = buildCategoryItems(state);

      const transactions = items.find((i) => i.key === 'transactions');
      expect(transactions?.status).toBe('will-delete');
      expect(transactions?.count).toBe(100);
    });

    it('should mark processed categories as empty when count = 0', () => {
      const emptyPreview = {
        ...mockPreviewWithoutRaw,
        transactions: 0,
      };
      const state = createClearViewState(mockScope, emptyPreview, emptyPreview, false);
      const items = buildCategoryItems(state);

      const transactions = items.find((i) => i.key === 'transactions');
      expect(transactions?.status).toBe('empty');
    });

    it('should mark raw categories as preserved when includeRaw is false and show counts from previewWithRaw', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const items = buildCategoryItems(state);

      const accounts = items.find((i) => i.key === 'accounts');
      expect(accounts?.status).toBe('preserved');
      expect(accounts?.count).toBe(3); // From previewWithRaw, not previewWithoutRaw
    });

    it('should mark raw categories as will-delete when includeRaw is true', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, true);
      const items = buildCategoryItems(state);

      const accounts = items.find((i) => i.key === 'accounts');
      expect(accounts?.status).toBe('will-delete');
      expect(accounts?.count).toBe(3);
    });

    it('should return exactly 5 items', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const items = buildCategoryItems(state);

      expect(items).toHaveLength(5);
    });

    it('should have correct group assignments', () => {
      const state = createClearViewState(mockScope, mockPreviewWithRaw, mockPreviewWithoutRaw, false);
      const items = buildCategoryItems(state);

      const processed = items.filter((i) => i.group === 'processed');
      const raw = items.filter((i) => i.group === 'raw');

      expect(processed).toHaveLength(2);
      expect(raw).toHaveLength(3);
    });
  });
});
