export function buildUtxoSourceComponentId(params: { outputIndex: number; transactionHash: string }): string {
  return `utxo:${params.transactionHash}:${params.outputIndex}`;
}
