import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyAIsxrezFn4O-XoSv4f9X-rQ_AMBG36cP8',
  authDomain: 'verzchat-909d4.firebaseapp.com',
  projectId: 'verzchat-909d4',
  storageBucket: 'verzchat-909d4.firebasestorage.app',
  messagingSenderId: '640273765062',
  appId: '1:640273765062:web:7795830f286aea5fa13dc7',
  measurementId: 'G-P1WW10DRN0',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
