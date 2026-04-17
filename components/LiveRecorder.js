import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// ── AssemblyAI direct upload ──────────────────────────────────
async function uploadToAssemblyAI(audioBlob, onProgress) {
  const ASSEMBLYAI_KEY = process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) throw new Error('AssemblyAI API key not configured');

  // Step 1: Upload audio file to AssemblyAI
  const formData = new FormData();
  formData.append('audio_data', audioBlob);

  let uploadUrl;
  try {
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': ASSEMBLYAI_KEY,
      },
      body: formData,
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    const uploadData = await uploadRes.json();
    uploadUrl = uploadData.upload_url;
  } catch (err) {
    throw new Error(`Failed to upload audio to AssemblyAI: ${err.message}`);
  }

  // Step 2: Submit for transcription
  let transcriptId;
  try {
    const transcribeRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': ASSEMBLYAI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadUrl,
        speech_models: ['universal-2'],  // Current API: plural with explicit model
      }),
    });

    if (!transcribeRes.ok) throw new Error(`Transcription submit failed: ${transcribeRes.status}`);
    const transcribeData = await transcribeRes.json();
    transcriptId = transcribeData.id;
  } catch (err) {
    throw new Error(`Failed to submit transcription: ${err.message}`);
  }

  // Step 3: Poll for completion (handles 4+ hour audio)
  let transcript = null;
  let maxAttempts = 1200; // 20 min with 1 sec poll, or 2+ hours with 6 sec poll
  let attempts = 0;
  let pollInterval = 2000; // Start polling every 2 seconds

  while (attempts < maxAttempts) {
    try {
      const statusRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        method: 'GET',
        headers: { 'Authorization': ASSEMBLYAI_KEY },
      });

      if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
      const statusData = await statusRes.json();

      if (statusData.status === 'completed') {
        transcript = statusData.text || '';
        break;
      }

      if (statusData.status === 'error') {
        throw new Error(`AssemblyAI error: ${statusData.error}`);
      }

      // Adjust polling interval based on audio progress
      if (statusData.confidence !== undefined && statusData.confidence > 0.5) {
        pollInterval = 6000; // Slow down when significant progress
      }

      // Show user-friendly progress
      const progressMsg = {
        'queued': '⏳ Waiting in queue... (0-5 min)',
        'processing': '⚙️ Processing audio... Extracting speech (5-30 min for longer files)',
        'completed': '✅ Done!',
      }[statusData.status] || `📊 Status: ${statusData.status}`;
      onProgress?.(progressMsg);
    } catch (err) {
      throw new Error(`Failed to check transcription status: ${err.message}`);
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  if (!transcript) throw new Error('Transcription timed out. Audio may be too long.');

  return transcript;
}

// ── Generate SRT from transcript ──────────────────────────────
function generateSRT(transcript, durationSec) {
  if (!transcript) return '';
  
  // Simple SRT generation - split by sentences
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
  const avgWordsPerSec = transcript.split(/\s+/).length / Math.max(durationSec, 1);
  
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

  return srt;
}

export default function LiveRecorder({ onTranscriptUpdate, onComplete }) {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [srt, setSrt] = useState('');
  const [duration, setDuration] = useState(0);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const durationRef = useRef(0);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const startRecording = async () => {
    setError('');
    setTranscript('');
    setSrt('');
    setUploadProgress('');
    chunksRef.current = [];
    setState('recording');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      setState('idle');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Allow microphone in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect one and try again.');
      } else {
        setError(`Microphone error: ${err.message}`);
      }
      return;
    }

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setState('transcribing');
      setUploadProgress('Uploading to AssemblyAI...');
      const mime = getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mime });

      try {
        const result = await uploadToAssemblyAI(blob, (msg) => setUploadProgress(msg));

        const generatedSrt = generateSRT(result, durationRef.current);

        setTranscript(result);
        setSrt(generatedSrt);
        setUploadProgress('');

        onTranscriptUpdate?.(result);
        onComplete?.(result, durationRef.current, generatedSrt);

        setState('stopped');

      } catch (err) {
        setError(`Transcription failed: ${err.message}`);
        setUploadProgress('');
        setState('idle');
      }
    };

    recorder.start(1000);
    durationRef.current = 0;
    setDuration(0);
    timerRef.current = setInterval(() => {
      durationRef.current += 1;
      setDuration(durationRef.current);
    }, 1000);
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current?.stop();
  };

  // ── SRT download helper ────────────────────────────────────
  const downloadSRT = () => {
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recording-transcript.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRecordAgain = () => {
    setState('idle');
    setTranscript('');
    setSrt('');
    durationRef.current = 0;
    setDuration(0);
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <div className={styles.recorder}>
      <div className={styles.controls}>
        {state === 'idle' && (
          <button className={'btn btn-primary ' + styles.recBtn} onClick={startRecording}>
            🎙 Start Recording
          </button>
        )}

        {state === 'recording' && (
          <div className={styles.recording}>
            <div className={styles.recIndicator}>
              <span className="rec-dot" />
              <span className={styles.recLabel}>Recording</span>
              <span className={styles.timer}>{fmt(duration)}</span>
            </div>
            <button className={'btn btn-danger'} onClick={stopRecording}>
              ⏹ Stop
            </button>
          </div>
        )}

        {state === 'transcribing' && (
          <div className={styles.recording}>
            <span className="spinner" style={{ marginRight: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Transcribing… please wait</span>
              {uploadProgress && <span style={{ fontSize: 12, opacity: 0.7 }}>{uploadProgress}</span>}
            </div>
          </div>
        )}

        {state === 'stopped' && (
          <div className={styles.stopped}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-green">✓ Done — {fmt(duration)}</span>
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
            <button className={'btn btn-ghost'} onClick={handleRecordAgain}>
              Record again
            </button>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {state === 'stopped' && transcript && (
        <div className={styles.liveTranscript}>
          <span className={styles.liveLabel}>Transcript</span>
          <div className={styles.transcriptText}>{transcript}</div>
        </div>
      )}
    </div>
  );
}