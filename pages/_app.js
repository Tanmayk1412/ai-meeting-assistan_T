import '../styles/globals.css';
import { AuthProvider } from '../lib/auth';
import { useEffect, useState } from 'react';

export default function App({ Component, pageProps }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(false);

  useEffect(() => {
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(reg => {
          console.log('✅ Service Worker registered:', reg.scope);
          
          // Check for updates every hour
          setInterval(() => {
            reg.update();
          }, 60 * 60 * 1000);
        })
        .catch(err => console.error('❌ Service Worker registration failed:', err));
    }

    // Handle PWA install prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setInstallPrompt(true);
      console.log('📱 Install prompt available');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Handle successful app installation
    const handleAppInstalled = () => {
      console.log('✅ App installed successfully!');
      setInstallPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return (
    <AuthProvider>
      <Component {...pageProps} deferredPrompt={deferredPrompt} installPrompt={installPrompt} />
    </AuthProvider>
  );
}
