// Shared client-side field validation - returns a Russian error message or
// null when valid. Purely a UX layer (instant, precise feedback pointing
// at the actual field) - the server re-validates everything itself
// regardless, so there's no security reliance on any of this.

export function validateRequiredText(value: string, label: string): string | null {
  if (!value.trim()) return `Введите ${label}`
  return null
}

export function validateDate(value: string): string | null {
  if (!value) return 'Выберите дату'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(new Date(value).getTime())) return 'Неверная дата'
  return null
}
