export default defineAppConfig({
  ui: {
    colors: {
      primary: 'cyan',
      neutral: 'slate',
    },
    button: {
      slots: {
        base: 'btn-press justify-center',
      },
    },
  },
  icon: {
    mode: 'svg',
    customize(content: string, _name: string, prefix: string) {
      if (prefix === 'lucide') {
        return content.replace(/stroke-width="[^"]*"/g, 'stroke-width="1.5"')
      }
      return content
    },
  },
})
