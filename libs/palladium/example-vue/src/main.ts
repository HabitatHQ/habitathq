import { createApp } from "vue";
import App from "./App.vue";
import { db, SCHEMA } from "./db.js";

await db.init(SCHEMA);
createApp(App).mount("#app");
