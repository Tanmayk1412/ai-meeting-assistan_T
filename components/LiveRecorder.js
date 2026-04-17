import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  console.log('🔍 Checking supported MIME types...');
  for (const type of types) {
    const supported = MediaRecorder.isTypeSupported(type);
    console.log(`  ${supported ? '✅' : '❌'} ${type}`);
    if (supported) {
      console.log(`✅ Using MIME type: ${type}`);
      return type;
    }
  }
  console.warn('⚠️ No MIME type supported! Falling back to empty string');
  return '';
}

// ── AssemblyAI direct upload ──────────────────────────────────
async function uploadToAssemblyAI(audioBlob, onProgress) {
  const ASSEMBLYAI_KEY = process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) throw new Error('AssemblyAI API key not configured');

  // Step 1: Upload audio file to AssemblyAI
  // Validate blob before sending - check magic bytes for WebM
  const arrayBuffer = await audioBlob.arrayBuffer();
  const header = new Uint8Array(arrayBuffer.slice(0, 4));
  const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('📊 Live recording blob info:');
  console.log('  • Header bytes:', headerHex);
  console.log('  • Size:', (audioBlob.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('  • Type:', audioBlob.type);

  let uploadUrl;
  try {
    // Send blob directly as body (not FormData) - AssemblyAI sniffs magic bytes
    console.log('📤 Starting upload to AssemblyAI...');
    console.log(`  Blob details:
    • Size: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB
    • Type: ${audioBlob.type || 'undefined (browser will set)'}
    • Headers will include: Content-Type: ${audioBlob.type || 'audio/webm'}`);
    
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': ASSEMBLYAI_KEY,
        'Content-Type': audioBlob.type || 'audio/webm',  // Explicit content type
      },
      body: audioBlob,  // Send blob directly, NOT FormData
    });

    console.log(`📥 Upload response status: ${uploadRes.status}`);
    
    if (!uploadRes.ok) {
      const errData = await uploadRes.text();
      console.error('❌ Upload failed:', uploadRes.status, errData);
      throw new Error(`Upload failed: ${uploadRes.status} - ${errData}`);
    }
    
    const uploadData = await uploadRes.json();
    uploadUrl = uploadData.upload_url;
    console.log('✅ Upload successful:', uploadUrl);
  } catch (err) {
    console.error('❌ Upload error:', err);
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
        language_code: 'en',  // Force English transcription
        speech_models: ['universal-2'],
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
    
    console.log('🎙️ MediaRecorder created:');
    console.log(`  MIME type: ${recorder.mimeType || 'default (browser chose)'}`);
    console.log(`  State: ${recorder.state}`);
    console.log(`  Audio tracks: ${stream.getAudioTracks().length}`);
    stream.getAudioTracks().forEach((track, i) => {
      console.log(`    Track ${i}: ${track.label} | enabled: ${track.enabled} | readyState: ${track.readyState}`);
    });

    recorder.ondataavailable = (e) => {
      console.log(`📦 Data chunk received: ${(e.data.size / 1024).toFixed(2)} KB | type: ${e.data.type}`);
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        console.log(`✅ Chunk added to buffer (total chunks: ${chunksRef.current.length})`);
      } else {
        console.warn('⚠️ Empty chunk received!');
      }
    };
    
    recorder.onerror = (e) => {
      console.error('❌ MediaRecorder error:', e);
      console.error('Error type:', e.error);
      setError(`❌ Recording error: ${e.error}`);
    };

    recorder.onstop = async () => {
      console.log('🛑 Recording stopped');
      setState('transcribing');
      setUploadProgress('Uploading to AssemblyAI...');
      
      if (chunksRef.current.length === 0) {
        const err = '❌ No audio recorded. Please try again.';
        console.error(err);
        setError(err);
        setState('idle');
        return;
      }
      
      const mime = getSupportedMimeType() || 'audio/webm';
      console.log(`📝 Creating blob: mime=${mime}, chunks=${chunksRef.current.length}`);
      
      // Log each chunk
      chunksRef.current.forEach((chunk, i) => {
        console.log(`  Chunk ${i}: ${(chunk.size / 1024).toFixed(2)} KB | ${chunk.type}`);
      });
      
      const blob = new Blob(chunksRef.current, { type: mime });

      // Validate blob before sending
      if (blob.size === 0) {
        const err = '❌ Recording is empty (0 bytes). Microphone may not be working.';
        console.error(err);
        setError(err);
        setState('idle');
        return;
      }

      console.log(`✅ Recording blob created: ${(blob.size / 1024 / 1024).toFixed(2)} MB | chunks: ${chunksRef.current.length}`);
      
      // Check first 32 bytes for WebM signature
      const header = await blob.slice(0, 32).arrayBuffer();
      const headerView = new Uint8Array(header);
      const headerHex = Array.from(headerView.slice(0, 12))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`📊 WebM header (first 12 bytes): [${headerHex}]`);
      
      // Verify WebM EBML signature: 1a 45 df a3
      if (!(headerView[0] === 0x1a && headerView[1] === 0x45 && headerView[2] === 0xdf && headerView[3] === 0xa3)) {
        console.warn('⚠️ WARNING: Blob does NOT start with WebM EBML signature!');
        console.warn('First 4 bytes should be: 1a 45 df a3');
        console.warn('Got:', Array.from(headerView.slice(0, 4))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' '));
      } else {
        console.log('✅ Valid WebM EBML signature found!');
      }

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