import { currentPeriod, offsetPeriod } from '~/utils/format'

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
