export const never = (_: never): never => {
  throw new Error('unreachable');
};
