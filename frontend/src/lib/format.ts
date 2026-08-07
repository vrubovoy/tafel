export function formatDateOnly(
  iso: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleDateString('ru-RU', { ...options, timeZone: 'UTC' })
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}
