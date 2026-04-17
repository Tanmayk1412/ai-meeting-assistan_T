import { useState, useEffect } from 'react';
import styles from '../styles/InstallPrompt.module.css';

export default function InstallPrompt({ deferredPrompt, onInstalled }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Show prompt after 3 seconds if not dismissed
    if (deferredPrompt && !dismissed && !localStorage.getItem('pwa-install-dismissed')) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [deferredPrompt, dismissed]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response: ${outcome}`);
      if (outcome === 'accepted') {
        setShow(false);
        onInstalled?.();
      }
    }
  };

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!show || !deferredPrompt) return null;

  return (
    <div className={styles.container}>
      <div className={styles.prompt}>
        <div className={styles.content}>
          <div className={styles.icon}>📲</div>
          <h3 className={styles.title}>Install App</h3>
          <p className={styles.text}>
            Install to home screen for offline access and faster loading
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnInstall} onClick={handleInstall}>
            Install
          </button>
          <button className={styles.btnCancel} onClick={handleDismiss}>
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
