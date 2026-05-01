/** Build an ECharts theme from Hearth CSS custom properties */
export function getHearthTheme(): Record<string, unknown> {
  const style = getComputedStyle(document.documentElement)
  const get = (prop: string) => style.getPropertyValue(prop).trim()

  return {
    backgroundColor: 'transparent',
    textStyle: {
      color: get('--ui-text-muted') || '#94a3b8',
      fontFamily: 'inherit',
    },
    title: {
      textStyle: { color: get('--ui-text') || '#e2e8f0' },
    },
    legend: {
      textStyle: { color: get('--ui-text-muted') || '#94a3b8' },
    },
    tooltip: {
      backgroundColor: get('--ui-bg-elevated') || '#172030',
      borderColor: get('--ui-border') || '#334155',
      textStyle: { color: get('--ui-text') || '#e2e8f0' },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: get('--ui-border') || '#334155' } },
      axisLabel: { color: get('--ui-text-muted') || '#94a3b8' },
      splitLine: { lineStyle: { color: get('--ui-border') || '#1e293b' } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: get('--ui-border') || '#334155' } },
      axisLabel: { color: get('--ui-text-muted') || '#94a3b8' },
      splitLine: { lineStyle: { color: get('--ui-border') || '#1e293b' } },
    },
  }
}
