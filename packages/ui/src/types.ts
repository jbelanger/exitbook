export interface ProgressEvent {
  type: 'started' | 'progress' | 'log' | 'warning' | 'error' | 'completed';
  message: string;
  source?: string;
  data?: {
    current?: number;
    metadata?: Record<string, unknown>;
    total?: number;
  };
  timestamp: number;
}

export interface ProgressEmitter {
  emit(event: Omit<ProgressEvent, 'timestamp'>): void;
}
