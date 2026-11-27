export function localDay(now: number): string {
  const date = new Date(now)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dueStatus(due: string | undefined, today: string): 'overdue' | 'today' | undefined {
  if (due === undefined) return undefined
  if (due < today) return 'overdue'
  return due === today ? 'today' : undefined
}

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false
  const time = `${value}T00:00:00.000Z`
  const date = new Date(time)
  return Number.isFinite(date.getTime()) && date.toISOString() === time
}
