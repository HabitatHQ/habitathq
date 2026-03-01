import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.habitat.app',
  appName: 'Habitat',
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
      iconColor: '#3b82f6',
    },
  },
}

export default config
