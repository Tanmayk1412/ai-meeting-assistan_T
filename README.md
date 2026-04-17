# AI Meeting Assistant

A modern PWA for recording, transcribing, and analyzing meetings with AI.

## 🚀 Features

- **Record Meetings** - Browser-based audio recording with MediaRecorder API
- **Auto Transcription** - Real-time transcription via AssemblyAI
- **AI Analysis** - Meeting summaries, action points, key decisions via OpenRouter
- **Mobile First** - Fully responsive PWA with offline support
- **Install to Home Screen** - Works like native app on Android & iOS
- **No Server Required** - Direct upload to AssemblyAI from browser

## 📱 Tech Stack

- **Frontend**: Next.js 14, React 18
- **PWA**: Service Workers, Web App Manifest
- **Audio**: MediaRecorder, FFmpeg.wasm (format conversion)
- **APIs**: AssemblyAI (transcription), OpenRouter (AI analysis)
- **Database**: Google Sheets via Apps Script
- **Hosting**: Vercel

## 🛠 Setup

```bash
# Install dependencies
npm install

# Add environment variables (.env.local)
NEXT_PUBLIC_APPS_SCRIPT_URL=https://...
NEXT_PUBLIC_ASSEMBLYAI_API_KEY=...
OPENROUTER_API_KEY=...

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

## 📋 Usage

1. Go to `/meeting/new`
2. **Record**: Click microphone icon and speak
3. **Or Upload**: Select audio file (WAV, MP3, FLAC, OGG)
4. **Wait**: Automatic transcription and analysis
5. **Save**: Download transcript + SRT subtitles
6. **View**: Check all meetings in dashboard

## 📦 Deployment

Deployed on **Vercel** with GitHub auto-deploy.

Environment variables configured in Vercel dashboard.

## 📄 License

MIT
