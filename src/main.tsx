import {createRoot} from 'react-dom/client';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/database';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && !(window as unknown as { firebase?: unknown }).firebase) {
  (window as unknown as { firebase?: unknown }).firebase = firebase;
}

createRoot(document.getElementById('root')!).render(<App />);
