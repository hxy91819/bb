export function visibleProviderId(
  providerId: string,
  hiddenProviderIds: readonly string[] | undefined,
): string {
  if (
    providerId.length === 0 ||
    hiddenProviderIds === undefined ||
    hiddenProviderIds.length === 0
  ) {
    return providerId;
  }
  return hiddenProviderIds.includes(providerId) ? "" : providerId;
}

export function selectVisibleProviders<T>(
  providers: readonly T[],
  hiddenProviderIds: readonly string[] | undefined,
  getProviderId: (provider: T) => string,
): readonly T[] {
  if (hiddenProviderIds === undefined || hiddenProviderIds.length === 0) {
    return providers;
  }
  const hidden = new Set(hiddenProviderIds);
  return providers.filter((provider) => !hidden.has(getProviderId(provider)));
}