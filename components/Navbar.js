import { useAuth } from '../lib/auth';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from '../styles/Navbar.module.css';

export default function Navbar({ deferredPrompt, installPrompt }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [showInstallPrompt, setShowInstallPrompt] = useState(installPrompt);

  const handleSignOut = () => {
    signOut();
    router.push('/');
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      if (outcome === 'accepted') {
        setShowInstallPrompt(false);
      }
    }
  };

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <span className={styles.icon}>◈</span>
        <span className={'app-name ' + styles.name}>AI Meetings</span>
      </div>
      <div className={styles.right}>
        {/* PWA Install Button */}
        {showInstallPrompt && deferredPrompt && (
          <button
            className="btn btn-primary"
            onClick={handleInstall}
            title="Install as app"
            style={{ fontSize: '12px', padding: '8px 12px' }}
          >
            📲 Install
          </button>
        )}

        {user && (
          <>
            <span className={styles.user}>
              <span className={styles.avatar}>{user.username?.[0]?.toUpperCase() || 'U'}</span>
              <span className={styles.username}>{user.username}</span>
            </span>
            <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: 13 }}>
              🚪 Out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
