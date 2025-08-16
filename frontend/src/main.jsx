// frontend/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { NotificationsProvider } from "./ui/notifications";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NotificationsProvider>          {/* 👈 envuelve la app */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </NotificationsProvider>
  </React.StrictMode>
);
