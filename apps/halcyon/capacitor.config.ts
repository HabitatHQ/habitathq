import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.halcyon.app',
  appName: 'Halcyon',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#000000',
    },
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#7c3aed',
    },
  },
}

export default config
