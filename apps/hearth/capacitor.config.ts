import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.hearth.family',
  appName: 'Hearth',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0c1219',
    },
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#f59e0b',
    },
  },
}

export default config
