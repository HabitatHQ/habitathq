<script setup lang="ts">
import TemplateRevisionEditor from '~/components/templates/TemplateRevisionEditor.vue'

const route = useRoute()
const templateId = computed(() => String(route.params['id'] ?? ''))
</script>

<template><TemplateRevisionEditor :template-id="templateId" /></template>
