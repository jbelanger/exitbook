// Money and precision types
export interface MoneyAmount {
  readonly value: bigint;
  readonly currency: string;
  readonly scale: number;
}