import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import { configureCloud, cloudSessionToken, setDeviceScanner } from '@workspace/api-client-react';

async function start() {
if (configureCloud(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  setDeviceScanner(async body => (await import('@workspace/api-client-react/device-ocr')).scanOnDevice(body));
  const token = await cloudSessionToken();
  if (token) localStorage.setItem('gt-token', token); else localStorage.removeItem('gt-token');
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
}
void start();
