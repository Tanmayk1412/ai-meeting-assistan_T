// Audio format converter using ffmpeg.wasm
// Converts ANY audio format to MP3 with full validation

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let ffmpegLoaded = false;

export async function loadFFmpeg() {
  if (ffmpegLoaded) return ffmpeg;

  ffmpeg = new FFmpeg();

  // Log FFmpeg output for debugging
  ffmpeg.on('log', ({ message }) => {
    console.debug('[FFmpeg]', message);
  });

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  ffmpegLoaded = true;
  console.log('✅ FFmpeg loaded successfully');
  return ffmpeg;
}

/**
 * Validates that a Uint8Array starts with valid MP3 magic bytes
 * MP3 files start with: FF FB / FF FA / FF F3 / FF F2 (MPEG frames)
 *   or: 49 44 33 (ID3 tag)
 */
function isValidMP3(uint8array) {
  if (!uint8array || uint8array.length < 4) {
    console.error('❌ Invalid MP3: too short', uint8array?.length);
    return false;
  }
  
  const [b0, b1] = uint8array;
  const hasID3 = b0 === 0x49 && b1 === 0x44; // "ID"
  const hasSyncFrame = b0 === 0xFF && (b1 & 0xE0) === 0xE0;
  
  if (!hasID3 && !hasSyncFrame) {
    console.error('❌ Invalid MP3 magic bytes:', b0.toString(16), b1.toString(16));
    return false;
  }
  
  return true;
}

/**
 * Convert any audio format to MP3 with validation
 */
export async function convertToMP3(file, onProgress) {
  const ff = await loadFFmpeg();

  const inputName = 'input_audio';
  const outputName = 'output.mp3';

  try {
    onProgress?.('📥 Reading input file...');
    
    // Step 1: Write input
    await ff.writeFile(inputName, await fetchFile(file));
    console.log('✅ Input file written to virtual filesystem');

    onProgress?.('🔄 Converting to MP3 (96kbps, mono, 22kHz)...');
    
    // Step 2: Run conversion with explicit codec
    const exitCode = await ff.exec([
      '-i', inputName,
      '-c:a', 'libmp3lame',  // explicit codec
      '-b:a', '96k',
      '-ac', '1',
      '-ar', '22050',
      '-f', 'mp3',           // explicit output format
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode} — conversion may have failed`);
    }
    
    console.log('✅ FFmpeg conversion completed');

    onProgress?.('📝 Validating output...');
    
    // Step 3: Read output — CRITICAL: unwrap correctly
    const rawOutput = await ff.readFile(outputName);
    console.log('ℹ️ readFile returned type:', typeof rawOutput, '| keys:', Object.keys(rawOutput || {}));

    // FFmpeg.wasm 0.12.x can return Uint8Array directly OR { data: Uint8Array }
    let uint8array;
    if (rawOutput instanceof Uint8Array) {
      uint8array = rawOutput;
      console.log('✅ readFile returned Uint8Array directly');
    } else if (rawOutput?.data instanceof Uint8Array) {
      uint8array = rawOutput.data;
      console.log('✅ readFile returned { data: Uint8Array } — unwrapped');
    } else {
      throw new Error(`Unexpected readFile return type: ${typeof rawOutput} | ${JSON.stringify(rawOutput)}`);
    }

    console.log('ℹ️ Output size:', (uint8array.length / 1024 / 1024).toFixed(2), 'MB');

    // Step 4: Validate magic bytes BEFORE creating Blob
    if (!isValidMP3(uint8array)) {
      const hex = Array.from(uint8array.slice(0, 12))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(
        `FFmpeg output is not a valid MP3. First 12 bytes: [${hex}]. ` +
        `Output size: ${uint8array.length} bytes.`
      );
    }

    console.log('✅ MP3 validation passed — magic bytes correct');

    onProgress?.('✅ Conversion complete!');

    // Step 5: Create Blob from ArrayBuffer (not from Uint8Array wrapper)
    const blob = new Blob([uint8array.buffer], { type: 'audio/mpeg' });
    console.log(`✅ Blob created: ${(blob.size / 1024 / 1024).toFixed(2)} MB | type: ${blob.type}`);

    // Step 6: Cleanup MEMFS
    await ff.deleteFile(inputName).catch(e => console.warn('⚠️ Failed to delete input:', e));
    await ff.deleteFile(outputName).catch(e => console.warn('⚠️ Failed to delete output:', e));

    return blob;

  } catch (err) {
    console.error('❌ Conversion error:', err);
    throw err;
  }
}

/**
 * Check if audio format needs conversion
 */
export const needsConversion = (file) => {
  const isMP3 = file.type === 'audio/mpeg' || file.name.endsWith('.mp3');
  return !isMP3; // Convert everything except MP3
};
