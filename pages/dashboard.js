import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/Navbar';
import { useAuth } from '../lib/auth';
import { getMeetings, deleteMeeting } from '../lib/api';
import styles from '../styles/Dashboard.module.css';

export default function Dashboard({ deferredPrompt, installPrompt }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [meetings, setMeetings] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  useEffect(() => {
    if (user) {
      // Try loading from cache first (instant display)
      const cached = localStorage.getItem(`meetings_${user.username}`);
      if (cached) {
        try {
          setMeetings(JSON.parse(cached));
          setFetching(false);
        } catch (e) {
          console.error('Cache parse error:', e);
        }
      }
      // Fetch fresh data in background
      fetchMeetings();
    }
  }, [user]);

  const fetchMeetings = async () => {
    if (meetings.length === 0) setFetching(true); // Show loader only if no cached data
    try {
      const data = await getMeetings(user.username);
      const meetingsList = data.meetings || [];
      setMeetings(meetingsList);
      // Cache for next visit
      localStorage.setItem(`meetings_${user.username}`, JSON.stringify(meetingsList));
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async (meetingId) => {
    if (!confirm('Delete this meeting?')) return;
    setDeleting(meetingId);
    try {
      await deleteMeeting(user.username, meetingId);
      setMeetings(m => m.filter(x => x.id !== meetingId));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const filtered = meetings.filter(m =>
    m.title?.toLowerCase().includes(search.toLowerCase()) ||
    m.summary?.toLowerCase().includes(search.toLowerCase())
  );

  const priorityColor = (p) => ({ high: '#EF4444', medium: '#F59E0B', low: '#10B981' }[p] || '#9CA3AF');

  if (loading || !user) return null;

  return (
    <div className={styles.page}>
      <Navbar deferredPrompt={deferredPrompt} installPrompt={installPrompt} />
      <main className={styles.main}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Meetings</h1>
            <p className={styles.subtitle}>
              {meetings.length} meeting{meetings.length !== 1 ? 's' : ''} recorded
              {fetching && meetings.length > 0 && ' • Updating…'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {user && user.isAdmin && (
              <button 
                className="btn btn-secondary" 
                onClick={() => router.push('/admin')}
                title="Admin panel"
              >
                ⚙️ Admin Panel
              </button>
            )}
            <button 
              className="btn btn-secondary" 
              onClick={() => fetchMeetings()}
              disabled={fetching}
              title="Refresh meetings"
            >
              {fetching ? '⟳ Refreshing…' : '↻ Refresh'}
            </button>
            <button className="btn btn-primary" onClick={() => router.push('/meeting/new')}>
              + New Meeting
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <input
            className={'input ' + styles.search}
            placeholder="Search meetings…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {fetching && meetings.length === 0 ? (
          <div className={styles.loading}>
            <span className="spinner" /> Loading meetings…
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>◈</div>
            <h3>No meetings yet</h3>
            <p>Record your first meeting and let AI do the heavy lifting.</p>
            <button className="btn btn-primary" onClick={() => router.push('/meeting/new')}>
              Start your first meeting
            </button>
          </div>
        ) : (
          <div className={styles.grid}>
            {filtered.map(meeting => (
              <div
                key={meeting.id}
                className={styles.card + ' card'}
                onClick={() => router.push(`/meeting/${meeting.id}`)}
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <span className="badge badge-blue">{meeting.type || 'Meeting'}</span>
                    <span className={styles.date}>
                      {new Date(meeting.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </span>
                  </div>
                  <button
                    className={'btn btn-danger ' + styles.deleteBtn}
                    onClick={e => { e.stopPropagation(); handleDelete(meeting.id); }}
                    disabled={deleting === meeting.id}
                  >
                    {deleting === meeting.id ? '…' : '✕'}
                  </button>
                </div>

                <h2 className={styles.cardTitle}>{meeting.title || 'Untitled Meeting'}</h2>

                {meeting.summary && (
                  <p className={styles.cardSummary}>{meeting.summary}</p>
                )}

                {meeting.actionPoints?.length > 0 && (
                  <div className={styles.actions}>
                    <span className={styles.actionsLabel}>Action Points</span>
                    <div className={styles.actionsList}>
                      {meeting.actionPoints.slice(0, 3).map((ap, i) => (
                        <div key={i} className={styles.actionItem}>
                          <span
                            className={styles.priorityDot}
                            style={{ background: priorityColor(ap.priority) }}
                          />
                          <span>{ap.task}</span>
                        </div>
                      ))}
                      {meeting.actionPoints.length > 3 && (
                        <span className={styles.more}>+{meeting.actionPoints.length - 3} more</span>
                      )}
                    </div>
                  </div>
                )}

                <div className={styles.cardFooter}>
                  <span className={styles.duration}>
                    {meeting.duration ? `${meeting.duration} min` : ''}
                  </span>
                  <span className={styles.viewLink}>View details →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
