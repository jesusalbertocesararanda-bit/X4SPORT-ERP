import {createRoot} from 'react-dom/client';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/database';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && !(window as unknown as { firebase?: unknown }).firebase) {
  (window as unknown as { firebase?: unknown }).firebase = firebase;
}

if (
  import.meta.env.PROD &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  window.location.protocol.startsWith('http')
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silenciar errores si el navegador o iframe restringe Service Workers
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
