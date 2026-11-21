import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { initializeLiveUpdates } from './live-update.ts';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    try {
      if (!sessionStorage.getItem('qataba_chunk_reloaded')) {
        sessionStorage.setItem('qataba_chunk_reloaded', '1');
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

void initializeLiveUpdates();
