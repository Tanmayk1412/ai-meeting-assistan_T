import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../../components/Navbar';
import LiveRecorder from '../../components/LiveRecorder';
import { useAuth } from '../../lib/auth';
import { saveMeeting } from '../../lib/api';
import { convertToMP3, needsConversion } from '../../lib/audioConverter';
import styles from '../../styles/NewMeeting.module.css';

export default function NewMeeting() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [inputMode, setInputMode] = useState('voice');
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [srt, setSrt] = useState('');                  // ← FIX 3: store SRT
  const [duration, setDuration] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploadState, setUploadState] = useState('idle');
  const [toast, setToast] = useState('');  // Auto-dismissing toast notification

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  // Auto-dismiss toast after 2 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const analyzeTranscript = async () => {
    if (!transcript.trim()) return;
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAiResult(data.result);
      if (!title) setTitle(generateTitle(transcript));
    } catch (err) {
      setError('AI analysis failed: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const generateTitle = (text) => {
    const words = text.split(' ').slice(0, 6).join(' ');
    return words.length > 3 ? words + '…' : 'New Meeting';
  };

  const saveMeetingData = async () => {
    if (!title.trim()) { setError('Please add a title.'); return; }
    if (!user?.username) { setError('❌ User not authenticated. Please login again.'); return; }
    setSaving(true);
    setError('');
    try {
      const meeting = {
        id: Date.now().toString(),
        title,
        transcript,
        srt,                                           // ← persist SRT if needed
        summary: aiResult?.summary || '',
        actionPoints: aiResult?.actionPoints || [],
        decisions: aiResult?.decisions || [],
        nextSteps: aiResult?.nextSteps || '',
        duration: Math.round(duration / 60),
        type: 'Meeting',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      console.log('💾 Saving meeting with username:', user.username);
      console.log('💾 Meeting object:', meeting);
      await saveMeeting(user.username, meeting);
      console.log('✅ Meeting saved successfully!');
      setToast('✅ Meeting saved successfully!');  // Auto-dismiss after 2 sec
      setTimeout(() => router.push(`/meeting/${meeting.id}`), 1500);  // Redirect after toast shows
    } catch (err) {
      console.error('❌ Save error:', err);
      setError('Save failed: ' + err.message);
      setSaving(false);
    }
  };

  // ── FIX 1: Direct AssemblyAI upload for large files ──
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setTranscript('');
    setSrt('');

    // ── DETAILED FILE DEBUGGING ──
    console.log('=== FILE UPLOAD DEBUG ===');
    console.log('File name:', file.name);
    console.log('File size:', file.size, 'bytes', `(${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log('File type (browser detected):', file.type);
    console.log('File lastModified:', new Date(file.lastModified).toISOString());
    
    // Check file extension
    const extension = file.name.split('.').pop()?.toLowerCase();
    console.log('File extension:', extension);
    
    // Try to read file header (magic bytes)
    const headerBuffer = await file.slice(0, 12).arrayBuffer();
    const headerView = new Uint8Array(headerBuffer);
    const headerHex = Array.from(headerView).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('File header (hex):', headerHex);
    
    // Detect real format from magic bytes
    let detectedFormat = 'unknown';
    if (headerHex.startsWith('ff fb') || headerHex.startsWith('ff fa')) detectedFormat = 'MP3';
    if (headerHex.startsWith('52 49 46 46')) detectedFormat = 'WAV or similar (RIFF)';
    if (headerHex.startsWith('ff f1') || headerHex.startsWith('ff f9')) detectedFormat = 'AAC';
    if (headerHex.startsWith('4f 67 67 53')) detectedFormat = 'OGG';
    if (headerHex.startsWith('1a 45 df a3')) detectedFormat = 'WebM';
    if (headerHex.startsWith('49 44 33')) detectedFormat = 'MP3 with ID3';
    
    console.log('Real format (from magic bytes):', detectedFormat);
    console.log('=== END DEBUG ===\n');

    // ── FILE VALIDATION ──
    const MAX_FILE_SIZE = 1024 * 1024 * 500; // 500MB

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`❌ File too large! Max 500MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }

    setUploadState('transcribing');

    try {
      const ASSEMBLYAI_KEY = process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY;
      if (!ASSEMBLYAI_KEY) throw new Error('AssemblyAI API key not configured');

      // ── AUDIO CONVERSION & COMPRESSION (if needed) ──
      let audioToUpload = file;
      if (needsConversion(file)) {
        setError('🔄 Converting & compressing audio to MP3...');
        audioToUpload = await convertToMP3(file, (msg) => {
          setError('🔄 ' + msg);
        });
        const originalSize = (file.size / 1024 / 1024).toFixed(2);
        const compressedSize = (audioToUpload.size / 1024 / 1024).toFixed(2);
        console.log(`✅ Compressed: ${originalSize}MB → ${compressedSize}MB (${Math.round((1 - audioToUpload.size / file.size) * 100)}% reduction)`);
      }

      // Step 1: Upload to AssemblyAI
      const formData = new FormData();
      
      // Force correct MIME type based on detected format
      let audioBlob = audioToUpload;
      const mimeTypeMap = {
        'MP3': 'audio/mpeg',
        'WAV or similar (RIFF)': 'audio/wav',
        'AAC': 'audio/aac',
        'OGG': 'audio/ogg',
        'WebM': 'audio/webm',
      };
      
      const correctMimeType = mimeTypeMap[detectedFormat] || audioToUpload.type || 'audio/mpeg';
      audioBlob = new Blob([audioToUpload], { type: correctMimeType });
      
      console.log('Sending to AssemblyAI with MIME type:', correctMimeType);
      
      formData.append('audio_data', audioBlob, audioToUpload.name);

      setUploadState('uploading');
      setError('📤 Uploading audio file... This may take a few minutes for large files.');
      const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: { 'Authorization': ASSEMBLYAI_KEY },
        body: formData,
      });

      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const uploadData = await uploadRes.json();
      const uploadUrl = uploadData.upload_url;

      // Step 2: Submit transcription
      setUploadState('transcribing');
      setError('🎤 Submitting for transcription... Converting speech to text.');
      
      const transcribeRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': ASSEMBLYAI_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          audio_url: uploadUrl,
          language_code: 'en',  // Force English transcription
          speech_models: ['universal-2'],
        }),
      });

      if (!transcribeRes.ok) {
        const errorText = await transcribeRes.text();
        console.error('❌ AssemblyAI Error Response:', errorText);
        throw new Error(`Transcription submit failed: ${transcribeRes.status} - ${errorText}`);
      }
      const transcribeData = await transcribeRes.json();
      const transcriptId = transcribeData.id;

      // Step 3: Poll for completion
      let transcript = null;
      let attempts = 0;
      const maxAttempts = 1200;
      let pollInterval = 2000;

      while (attempts < maxAttempts) {
        const statusRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          method: 'GET',
          headers: { 'Authorization': ASSEMBLYAI_KEY },
        });

        if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'completed') {
          transcript = statusData.text || '';
          setError('✅ Transcription complete! Processing results...');
          break;
        }

        if (statusData.status === 'error') {
          throw new Error(`AssemblyAI error: ${statusData.error}`);
        }

        // Show user-friendly progress
        const progressMsg = {
          'queued': '⏳ Waiting in queue... (0-5 min)',
          'processing': '⚙️ Processing audio... Extracting speech (5-30 min for longer files)',
          'completed': '✅ Done!',
        }[statusData.status] || `📊 Status: ${statusData.status}`;
        setError(progressMsg);

        if (statusData.confidence !== undefined && statusData.confidence > 0.5) {
          pollInterval = 6000;
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!transcript) throw new Error('Transcription timed out. Audio may be too long.');

      setTranscript(transcript);
      setUploadState('done');
      setError('');  // Clear error on success

      // Generate SRT
      const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
      const avgWordsPerSec = transcript.split(/\s+/).length / Math.max(file.duration || 60, 1);
      let srt = '';
      let currentTime = 0;
      let index = 1;

      sentences.forEach(sentence => {
        const words = sentence.trim().split(/\s+/).length;
        const duration = Math.ceil(words / avgWordsPerSec);
        const startTime = currentTime;
        const endTime = currentTime + duration;

        const timeFormat = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = sec % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`;
        };

        srt += `${index}\n${timeFormat(startTime)} --> ${timeFormat(endTime)}\n${sentence.trim()}\n\n`;
        currentTime = endTime;
        index++;
      });

      setTranscript(transcript);
      setSrt(srt);
      setUploadState('done');
    } catch (err) {
      setError('Upload transcription failed: ' + err.message);
      setUploadState('idle');
    }
  };

  // ── SRT download helper ────────────────────────────────────
  const downloadSRT = () => {
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'transcript') + '.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !user) return null;

  return (
    <div className={styles.page}>
      {/* Auto-dismissing toast notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          background: '#10b981',
          color: 'white',
          padding: '12px 24px',
          borderRadius: 8,
          zIndex: 9999,
          animation: 'slideInRight 0.3s ease-out, slideOutRight 0.3s ease-out 1.7s',
          fontSize: 14,
          fontWeight: 500,
        }}>
          {toast}
        </div>
      )}
      <Navbar />
      <main className={styles.main}>
        <div className={styles.header}>
          <button className="btn btn-ghost" onClick={() => router.back()}>← Back</button>
          <h1 className={styles.title}>New Meeting</h1>
        </div>

        <div className={styles.layout}>
          {/* Left: Input */}
          <div className={styles.inputSection}>
            <div className={'card ' + styles.card}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Meeting Title</label>
                <input
                  className="input"
                  placeholder="e.g. Q2 Planning Session"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className={styles.modeTabs}>
                <button
                  className={styles.modeTab + (inputMode === 'voice' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('voice')}
                >
                  🎙 Live Voice
                </button>
                <button
                  className={styles.modeTab + (inputMode === 'text' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('text')}
                >
                  ✏️ Type / Paste
                </button>
                <button
                  className={styles.modeTab + (inputMode === 'upload' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('upload')}
                >
                  📁 Upload Audio
                </button>
              </div>

              {/* ── FIX 3: pass srt through onComplete ── */}
              {inputMode === 'voice' && (
                <LiveRecorder
                  onTranscriptUpdate={setTranscript}
                  onComplete={(t, d, s) => {
                    setTranscript(t);
                    setDuration(d);
                    if (s) setSrt(s);                // ← capture SRT from live recording
                  }}
                />
              )}

              {inputMode === 'text' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Transcript / Meeting Notes</label>
                  <textarea
                    className="input"
                    rows={10}
                    placeholder="Paste your meeting transcript or type notes here…"
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                  />
                </div>
              )}

              {inputMode === 'upload' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Audio File</label>
                  <p style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 8 }}>
                    Supports mp3, mp4, wav, m4a, flac, ogg, aac, wma, mov, webm, amr and more
                  </p>
                  <input
                    type="file"
                    accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.webm,.ogg,.flac,.mov,.aac,.wma,.amr"
                    className="input"
                    style={{ padding: '10px' }}
                    onChange={handleFileUpload}
                  />

                  {uploadState === 'transcribing' && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-500)' }}>
                      <span className="spinner" />
                      <span>Transcribing your file… please wait</span>
                    </div>
                  )}

                  {/* ── FIX 1 + 3: done state with SRT download button ── */}
                  {uploadState === 'done' && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-green">✓ Transcription complete — scroll down to analyze</span>
                      {srt && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 13, padding: '4px 12px' }}
                          onClick={downloadSRT}
                        >
                          ↓ Download .srt
                        </button>
                      )}
                    </div>
                  )}

                  {uploadState === 'done' && transcript && (
                    <div className={styles.fieldGroup} style={{ marginTop: 16 }}>
                      <label className={styles.label}>Transcript Preview</label>
                      <div style={{
                        background: 'var(--off-white)',
                        border: '1px solid var(--gray-200)',
                        borderRadius: 8,
                        padding: 12,
                        fontSize: 13,
                        color: 'var(--gray-600)',
                        maxHeight: 150,
                        overflowY: 'auto',
                        lineHeight: 1.6,
                      }}>
                        {transcript}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.actions}>
                <button
                  className="btn btn-primary"
                  onClick={analyzeTranscript}
                  disabled={analyzing || !transcript.trim()}
                >
                  {analyzing ? <><span className="spinner" /> Analyzing…</> : '✦ Analyze with AI'}
                </button>
              </div>
            </div>
          </div>

          {/* Right: AI Results */}
          <div className={styles.resultsSection}>
            {!aiResult && !analyzing && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>✦</div>
                <h3>AI Analysis</h3>
                <p>Record or type your meeting content, then click "Analyze with AI" to extract action points, decisions, and a summary.</p>
              </div>
            )}

            {analyzing && (
              <div className={styles.analyzingState}>
                <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                <p>Reading your meeting…</p>
              </div>
            )}

            {aiResult && (
              <div className={styles.results + ' fade-in'}>
                <div className={'card ' + styles.resultCard}>
                  <h3 className={styles.resultTitle}>Summary</h3>
                  <p className={styles.summary}>{aiResult.summary}</p>
                </div>

                {aiResult.actionPoints?.length > 0 && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>
                      Action Points
                      <span className="badge badge-blue" style={{ marginLeft: 8 }}>
                        {aiResult.actionPoints.length}
                      </span>
                    </h3>
                    <div className={styles.apList}>
                      {aiResult.actionPoints.map((ap, i) => (
                        <div key={i} className={styles.apItem}>
                          <div className={styles.apHeader}>
                            <span className={styles.apTask}>{ap.task}</span>
                            <span className={styles['priority-' + ap.priority] + ' badge'}>
                              {ap.priority}
                            </span>
                          </div>
                          <div className={styles.apMeta}>
                            <span>👤 {ap.owner}</span>
                            <span>📅 {ap.dueDate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiResult.decisions?.length > 0 && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>Decisions Made</h3>
                    <ul className={styles.decisionList}>
                      {aiResult.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.nextSteps && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>Next Steps</h3>
                    <p className={styles.summary}>{aiResult.nextSteps}</p>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                  onClick={saveMeetingData}
                  disabled={saving}
                >
                  {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Meeting'}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}