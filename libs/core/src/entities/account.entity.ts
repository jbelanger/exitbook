// Account entity placeholder
export interface AccountEntity {
  accountType: string;
  createdAt: Date;
  currencyId: number;
  externalAddress?: string;
  id: number;
  name: string;
  network?: string;
  parentAccountId?: number;
  source?: string;
  updatedAt: Date;
}
