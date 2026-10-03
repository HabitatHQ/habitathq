export default defineAppConfig({
  ui: {
    colors: { primary: 'orange', neutral: 'zinc' },
    button: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class:
            'text-(--color-on-accent) hover:bg-(--color-accent-hover) active:bg-(--color-accent-hover)',
        },
      ],
    },
    icons: {
      close: 'i-ph-x',
      check: 'i-ph-check',
      loading: 'i-ph-circle-notch',
      search: 'i-ph-magnifying-glass',
      chevronDown: 'i-ph-caret-down',
      chevronUp: 'i-ph-caret-up',
      chevronLeft: 'i-ph-caret-left',
      chevronRight: 'i-ph-caret-right',
      arrowLeft: 'i-ph-arrow-left',
      arrowRight: 'i-ph-arrow-right',
      minus: 'i-ph-minus',
      plus: 'i-ph-plus',
    },
  },
})
