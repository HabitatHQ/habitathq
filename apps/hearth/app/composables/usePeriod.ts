import { addCalendarDays, localCalendarDate } from '@habitathq/utils'

export function currentPeriod(): string {
  return localCalendarDate().slice(0, 7)
}

export function offsetPeriod(period: string, offset: number): string {
  let result = `${period}-01`
  const direction = Math.sign(offset)
  for (let i = 0; i < Math.abs(offset); i++) {
    result = direction < 0 ? addCalendarDays(result, -1) : addCalendarDays(result, 31)
    result = `${result.slice(0, 7)}-01`
  }
  return result.slice(0, 7)
}

export function usePeriod() {
  const period = ref(currentPeriod())
  const isCurrentPeriod = computed(() => period.value === currentPeriod())

  function prevPeriod() {
    period.value = offsetPeriod(period.value, -1)
  }

  function nextPeriod() {
    period.value = offsetPeriod(period.value, 1)
  }

  return { period, isCurrentPeriod, prevPeriod, nextPeriod }
}
