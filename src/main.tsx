import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./styles.css";

const shouldClearServiceWorkerCache = import.meta.env.DEV || Capacitor.isNativePlatform();

if (shouldClearServiceWorkerCache && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
}

if (shouldClearServiceWorkerCache && "caches" in window) {
  caches.keys().then((keys) => {
    keys.forEach((key) => void caches.delete(key));
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
