// Money and precision types
export interface MoneyAmount {
  readonly currency: string;
  readonly scale: number;
  readonly value: bigint;
}
