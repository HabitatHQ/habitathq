import { createApp } from "vue";
import App from "./App.vue";
import { db } from "./db.js";

await db.init();
createApp(App).mount("#app");
