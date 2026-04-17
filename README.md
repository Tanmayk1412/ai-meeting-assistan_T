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

## � Admin Panel

### Login as Admin
- Go to `/` (login page)
- Login with admin credentials
- Admin users are **automatically redirected** to `/admin`

### Admin Features
- **View all users** - See complete user list with email, phone, admin status
- **View all meetings** - Browse every meeting from all users
- **Retrieve passwords** - One-click password retrieval for users who forgot theirs
- **Copy to clipboard** - Easy password sharing with users

### Setup Admin User

To make a user an admin:

1. Open your **Google Sheet** (from SHEET_ID in Code.gs)
2. Go to the **AUTH** sheet
3. Find the user row you want to make admin
4. Set the `is_admin` column to `true` (or TRUE)
5. User will have admin access on **next login**

### Example Admin Workflow

**User forgets password:**
1. User calls/emails you
2. You login to the app with admin account
3. Go to Admin Panel → Users tab
4. Find user → Click "Get Password"
5. Modal shows encrypted password
6. Click "Copy to Clipboard"
7. Send password to user → They can login

### Default Admin Setup

To create your first admin user:

1. Register a new user account normally (e.g., username: `admin`)
2. Edit the **AUTH sheet** in your Google Sheet
3. Set `is_admin` column to `true` for that user
4. Log out and log back in → Should see Admin Panel

## �📦 Deployment

Deployed on **Vercel** with GitHub auto-deploy.

Environment variables configured in Vercel dashboard.

## 📄 License

MIT
