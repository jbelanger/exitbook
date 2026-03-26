export const SQLITE_SAFE_IN_BATCH_SIZE = 500;
export const SQLITE_SAFE_INSERT_BATCH_SIZE = 100;

export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error(`Chunk size must be greater than 0, received ${size}`);
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
