export default defineNuxtRouteMiddleware((to) => {
  // Only apply on the client side
  if (!import.meta.client) return

  const { settings } = useAppSettings()

  if (!settings.value.hasCompletedOnboarding && to.path !== '/welcome') {
    return navigateTo('/welcome')
  }

  // Prevent users from revisiting the welcome page once onboarded
  if (settings.value.hasCompletedOnboarding && to.path === '/welcome') {
    return navigateTo('/')
  }
})
