export class AccountRemovalTargetNotFoundError extends Error {
  constructor(accountName: string) {
    super(`Account '${accountName.trim().toLowerCase()}' not found`);
    this.name = 'AccountRemovalTargetNotFoundError';
  }
}
