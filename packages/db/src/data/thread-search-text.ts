export function normalizeThreadSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase();
}
