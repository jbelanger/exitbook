import { Context, Layer } from 'effect';

export interface Clock {
  clearTestTime(): void;
  now(): Date;
  setTestTime(date: Date): void;
}

export const Clock = Context.GenericTag<Clock>('Clock');

export class SystemClock implements Clock {
  private testTime?: Date;

  now(): Date {
    return this.testTime || new Date();
  }

  setTestTime(date: Date): void {
    this.testTime = date;
  }

  clearTestTime(): void {
    delete (this as unknown).testTime;
  }
}

export const SystemClockLayer = Layer.succeed(Clock, new SystemClock());
