/**
 * Asserts that a Result is Ok and returns its value. Throws with a descriptive
 * message if the result is an Err, causing the test to fail.
 */
export function assertOk<T, E>(result: { error?: E; isOk(): boolean; value?: T }): T {
  if (!result.isOk()) {
    throw new Error(`Expected Result to be Ok, but got Err: ${String(result.error)}`);
  }
  return result.value as T;
}

/**
 * Asserts that a Result is Err and returns its error. Throws with a descriptive
 * message if the result is Ok, causing the test to fail.
 */
export function assertErr<T, E>(result: { error?: E; isErr(): boolean; value?: T }): E {
  if (!result.isErr()) {
    throw new Error(`Expected Result to be Err, but got Ok: ${String(result.value)}`);
  }
  return result.error as E;
}
