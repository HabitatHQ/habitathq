import { createApp } from "vue";
import App from "./App.vue";

// Devices are created per-card inside the app, so there is no global db.init
// here — each pane owns its own engine + sync uplink.
createApp(App).mount("#app");
