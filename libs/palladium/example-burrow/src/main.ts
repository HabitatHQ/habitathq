import { createApp } from "vue";
import App from "./App.vue";
import "./sections/section.css";

// The active account (engine + Atrium uplink) is created inside the app once a
// user is chosen and a workspace is active — there is no global db.init here.
createApp(App).mount("#app");
