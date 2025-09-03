// Account entity placeholder
export interface AccountEntity {
  id: number;
  name: string;
  currencyId: number;
  accountType: string;
  network?: string;
  externalAddress?: string;
  source?: string;
  parentAccountId?: number;
  createdAt: Date;
  updatedAt: Date;
}