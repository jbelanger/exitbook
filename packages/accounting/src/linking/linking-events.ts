/**
 * Events emitted by transaction linking operations.
 * Used for CLI progress display and UI decoupling.
 */

export type LinkingEvent =
  // Load phase events
  | {
      type: 'load.started';
    }
  | {
      totalTransactions: number;
      type: 'load.completed';
    }
  // Existing links cleared event
  | {
      count: number;
      type: 'existing.cleared';
    }
  // Match phase events
  | {
      type: 'match.started';
    }
  | {
      confirmedCount: number;
      internalCount: number;
      sourceCount: number;
      suggestedCount: number;
      targetCount: number;
      type: 'match.completed';
    }
  // Save phase events
  | {
      type: 'save.started';
    }
  | {
      totalSaved: number;
      type: 'save.completed';
    };
