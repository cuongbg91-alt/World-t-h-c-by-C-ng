import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ngăn chặn các thông báo lỗi hoặc cảnh báo phiền toái liên quan đến HMR WebSocket trong môi trường Sandbox
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reasonStr = event.reason ? String(event.reason.message || event.reason) : "";
    if (reasonStr.includes("WebSocket") || reasonStr.includes("vite") || reasonStr.includes("HMR")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ");
    if (msg.includes("WebSocket") || msg.includes("failed to connect to websocket") || msg.includes("[vite]")) {
      return;
    }
    originalConsoleError(...args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
