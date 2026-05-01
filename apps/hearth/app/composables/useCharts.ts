import { ref, shallowRef } from 'vue'

const loaded = ref(false)
const loading = ref(false)
// biome-ignore lint/suspicious/noExplicitAny: echarts module is dynamically imported
const echartsModule = shallowRef<any>(null)

/**
 * Lazy-load ECharts with only the chart types and components used by Hearth.
 * Tree-shakes everything else out of the ~300KB bundle.
 */
export function useCharts() {
  async function ensureLoaded() {
    if (loaded.value) return echartsModule.value
    if (loading.value) {
      // Wait for existing load to finish
      await new Promise<void>((resolve) => {
        const stop = watch(loaded, (v) => {
          if (v) {
            stop()
            resolve()
          }
        })
      })
      return echartsModule.value
    }

    loading.value = true
    const echarts = await import('echarts/core')
    const { PieChart, LineChart, BarChart } = await import('echarts/charts')
    const { TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent } =
      await import('echarts/components')
    const { CanvasRenderer } = await import('echarts/renderers')

    echarts.use([
      PieChart,
      LineChart,
      BarChart,
      TitleComponent,
      TooltipComponent,
      LegendComponent,
      GridComponent,
      MarkLineComponent,
      CanvasRenderer,
    ])

    echartsModule.value = echarts
    loaded.value = true
    loading.value = false
    return echarts
  }

  return { ensureLoaded, loaded, loading, echarts: echartsModule }
}
