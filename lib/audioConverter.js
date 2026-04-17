// Audio format converter using ffmpeg.wasm
// Converts ANY audio format to MP3

import { FFmpeg, fetchFile } from '@ffmpeg/ffmpeg';

let ffmpeg = null;
let isLoading = false;

// Initialize FFmpeg (lazy load)
const initFFmpeg = async () => {
  if (ffmpeg?.loaded) return;
  if (isLoading) return;
  
  isLoading = true;
  ffmpeg = new FFmpeg();
  
  try {
    await ffmpeg.load();
    isLoading = false;
  } catch (err) {
    console.error('Failed to load FFmpeg:', err);
    isLoading = false;
    throw new Error('Audio conversion not available. Please use MP3 files.');
  }
};

/**
 * Convert any audio format to MP3
 * @param {File} audioFile - Audio file (any format)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Blob>} MP3 blob
 */
export const convertToMP3 = async (audioFile, onProgress) => {
  // Skip conversion only for MP3 files (proven reliable)
  if ((audioFile.type === 'audio/mpeg' || audioFile.name.endsWith('.mp3')) && audioFile.size < 1024 * 1024 * 100) {
    onProgress?.('File is already MP3, using as-is...');
    return audioFile;
  }

  // For everything else (WAV, FLAC, OGG, etc.), convert to MP3
  onProgress?.('🔄 Converting & compressing to MP3... (this may take a minute)');
  
  await initFFmpeg();

  try {
    const inputName = 'input_audio';
    const outputName = 'output.mp3';

    // Write file to FFmpeg virtual filesystem
    await ffmpeg.writeFile(inputName, await fetchFile(audioFile));
    onProgress?.('📝 Compressing audio (96kbps, mono, 22kHz)...');

    // Convert to MP3 with compression optimized for speech
    await ffmpeg.exec([
      '-i', inputName,
      '-b:a', '96k',   // 96kbps bitrate - optimal for speech/meetings
      '-ac', '1',      // mono - saves space, good for speech
      '-ar', '22050',  // 22.05kHz - good for speech (reduces file size)
      outputName
    ]);
    onProgress?.('✅ Conversion complete!');

    // Read converted file
    const data = await ffmpeg.readFile(outputName);
    
    // Clean up
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    // Create MP3 blob
    const mp3Blob = new Blob([data.buffer], { type: 'audio/mpeg' });
    
    console.log(`✅ Converted ${audioFile.name} to MP3 (${(mp3Blob.size / 1024 / 1024).toFixed(2)}MB)`);
    return mp3Blob;
  } catch (err) {
    console.error('Conversion error:', err);
    throw new Error(`Audio conversion failed: ${err.message}. Please try an MP3 or OGG file.`);
  }
};

/**
 * Check if audio format needs conversion
 * Always convert WAV files (codec compatibility issues) and unknown formats
 * Only skip MP3, WebM, OGG which work reliably with AssemblyAI
 */
export const needsConversion = (file) => {
  // These formats are proven to work with AssemblyAI
  const reliableFormats = ['audio/mpeg', 'audio/webm', 'audio/ogg'];
  const isReliableFormat = reliableFormats.includes(file.type) || 
                           file.name.match(/\.(mp3|webm|ogg)$/i);
  
  // WAV files often have codec issues → always convert for reliability
  const isWav = file.type === 'audio/wav' || file.name.match(/\.wav$/i);
  
  // Convert if: NOT a reliable format, OR is WAV
  return !isReliableFormat || isWav;
};
