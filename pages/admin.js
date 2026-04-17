import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/Navbar';
import { useAuth } from '../lib/auth';
import { getAllUsers, getAllMeetings, getPassword } from '../lib/api';
import styles from '../styles/Dashboard.module.css';

export default function AdminPanel({ deferredPrompt, installPrompt }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('users'); // 'users' | 'meetings'
  const [users, setUsers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [passwordModal, setPasswordModal] = useState(null);
  const [retrievedPassword, setRetrievedPassword] = useState('');

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) {
      router.push('/');
    }
  }, [user, loading]);

  useEffect(() => {
    if (user && user.isAdmin) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    setFetching(true);
    try {
      const [usersData, meetingsData] = await Promise.all([
        getAllUsers(user.username),
        getAllMeetings(user.username),
      ]);
      setUsers(usersData.users || []);
      setMeetings(meetingsData.meetings || []);
    } catch (err) {
      console.error(err);
      alert('Failed to load admin data');
    } finally {
      setFetching(false);
    }
  };

  const handleRetrievePassword = async (userIdentifier) => {
    try {
      const data = await getPassword(userIdentifier);
      setRetrievedPassword(data.password);
      setPasswordModal(userIdentifier);
    } catch (err) {
      alert('Failed to retrieve password: ' + err.message);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(retrievedPassword);
    alert('Password copied to clipboard!');
  };

  if (loading || !user || !user.isAdmin) return null;

  return (
    <div className={styles.page}>
      <Navbar deferredPrompt={deferredPrompt} installPrompt={installPrompt} />
      <main className={styles.main}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Admin Panel</h1>
            <p className={styles.subtitle}>Manage users and meetings</p>
          </div>
          <button className="btn btn-secondary" onClick={() => router.push('/dashboard')}>
            ← My Meetings
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button
            className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('users')}
          >
            👥 Users ({users.length})
          </button>
          <button
            className={`btn ${tab === 'meetings' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('meetings')}
          >
            📋 All Meetings ({meetings.length})
          </button>
        </div>

        {fetching ? (
          <div className={styles.loading}>
            <span className="spinner" /> Loading admin data…
          </div>
        ) : tab === 'users' ? (
          <div>
            {users.length === 0 ? (
              <div className={styles.empty}>
                <p>No users found</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '14px',
                }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--blue)' }}>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Username</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Email</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Phone</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Admin</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid var(--gray-200)',
                          background: i % 2 === 0 ? 'white' : 'var(--gray-50)',
                        }}
                      >
                        <td style={{ padding: '12px' }}>
                          <strong>{u.username}</strong>
                        </td>
                        <td style={{ padding: '12px' }}>{u.email || '—'}</td>
                        <td style={{ padding: '12px' }}>{u.phone || '—'}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {u.isAdmin ? '✓ Admin' : ''}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <span className="badge badge-green">{u.active ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleRetrievePassword(u.username)}
                          >
                            🔑 Get Password
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div>
            {meetings.length === 0 ? (
              <div className={styles.empty}>
                <p>No meetings found</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {meetings.map((m, i) => (
                  <div key={i} className="card" style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <div style={{ marginBottom: '8px' }}>
                          <span className="badge badge-blue" style={{ marginRight: '8px' }}>
                            {m.owner}
                          </span>
                          <span className="badge badge-gray">
                            {new Date(m.createdAt).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric'
                            })}
                          </span>
                        </div>
                        <h3 style={{ marginBottom: '8px' }}>{m.title || 'Untitled'}</h3>
                        {m.summary && (
                          <p style={{ color: 'var(--gray-600)', fontSize: '13px', marginBottom: '8px' }}>
                            {m.summary}
                          </p>
                        )}
                        <p style={{ color: 'var(--gray-500)', fontSize: '12px' }}>
                          {m.duration ? `${m.duration} min` : ''} • {m.actionPoints?.length || 0} action points
                        </p>
                      </div>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => router.push(`/meeting/${m.id}`)}
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Password Modal */}
      {passwordModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="card" style={{
            padding: '24px',
            maxWidth: '400px',
            width: '90%',
          }}>
            <h2 style={{ marginBottom: '16px' }}>Password for {passwordModal}</h2>
            <div style={{
              background: 'var(--gray-100)',
              padding: '12px',
              borderRadius: '8px',
              fontFamily: 'monospace',
              fontSize: '14px',
              marginBottom: '16px',
              wordBreak: 'break-all',
            }}>
              {retrievedPassword}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" onClick={copyToClipboard}>
                📋 Copy to Clipboard
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setPasswordModal(null);
                  setRetrievedPassword('');
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
