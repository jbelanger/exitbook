export function defineChainRegistry<TConfig, const TRegistry extends Record<string, unknown>>(
  registry: TRegistry
): { [TChainName in keyof TRegistry]: TConfig } {
  return registry as { [TChainName in keyof TRegistry]: TConfig };
}

export function mapChainRegistryValues<const TRegistry extends Record<string, TInput>, TInput, TOutput>(
  registry: TRegistry,
  mapValue: <TChainName extends keyof TRegistry>(chainName: TChainName, config: TRegistry[TChainName]) => TOutput
): { [TChainName in keyof TRegistry]: TOutput } {
  const mappedRegistry = {} as { [TChainName in keyof TRegistry]: TOutput };

  for (const chainName of Object.keys(registry) as (keyof TRegistry)[]) {
    mappedRegistry[chainName] = mapValue(chainName, registry[chainName]);
  }

  return mappedRegistry;
}
