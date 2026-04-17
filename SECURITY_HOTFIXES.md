# 🚨 CRITICAL SECURITY FIXES - IMMEDIATE ACTION REQUIRED

## DO THIS TODAY

### 1. Revoke Exposed API Keys
```bash
# AssemblyAI
# Go to: https://www.assemblyai.com/app/account
# Delete key: 3a08a427d01e47d2be23dc1bbc61c703

# OpenRouter  
# Go to: https://openrouter.ai/account/api-keys
# Delete key: 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
```

### 2. Move Secrets to Vercel
```bash
# Vercel Dashboard > Your Project > Settings > Environment Variables
# Add:
NEXT_PUBLIC_ASSEMBLYAI_API_KEY=<new-key>
OPENROUTER_API_KEY=<new-key>
JWT_SECRET=<generate-strong-secret>
```

### 3. Add .env.local to .gitignore
```bash
echo ".env.local" >> .gitignore
git add .gitignore
git commit -m "Add .env.local to gitignore"
git push
```

### 4. Clean Git History
```bash
# Option A: Force push (if repo is private)
git filter-repo --paths .env.local --invert-paths --force

# Option B: Mark as secret on GitHub
# GitHub > Settings > Security > Secret scanning
```

---

## WEEK 1 FIXES (Priority Order)

### Issue #1: Auth Vulnerability - Client-Side Cookie Spoofing
**File:** [lib/auth.js](lib/auth.js)  
**Fix:** Implement JWT with server-side validation

```javascript
// lib/auth.js - REPLACE
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Don't trust cookies - validate on backend
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        if (data.user) setUser(data.user);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = (userData) => {
    setUser(userData);
    // Let backend set httpOnly cookie
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
```

**New Files to Create:**
```javascript
// pages/api/auth/login.js
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { identifier, password } = req.body;
  
  try {
    // Call Apps Script to verify credentials
    const userRes = await fetch(process.env.NEXT_PUBLIC_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', identifier, password })
    });
    
    const userData = await userRes.json();
    if (!userData.success) throw new Error(userData.error);
    
    // Create JWT token
    const token = jwt.sign(
      { userId: userData.user.username, iat: Date.now() },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Set httpOnly cookie
    res.setHeader('Set-Cookie', 
      `token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
    );
    
    res.json({ success: true, user: userData.user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}

// pages/api/auth/me.js
import jwt from 'jsonwebtoken';

export default (req, res) => {
  const token = req.cookies.token;
  
  if (!token) return res.json({ user: null });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: { username: decoded.userId } });
  } catch {
    res.json({ user: null });
  }
};
```

---

### Issue #2: CSRF Protection Missing
**Files:** [lib/api.js](lib/api.js), [pages/api/apps-script.js](pages/api/apps-script.js)

```javascript
// lib/api.js - ADD to request wrapper
async function request(action, payload = {}) {
  try {
    // Get CSRF token from meta tag or generate
    const token = document.querySelector('meta[name="csrf-token"]')?.content 
      || await fetch('/api/csrf-token').then(r => r.json()).then(d => d.token);
    
    const res = await fetch(`${PROXY_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,  // ← ADD THIS
      },
      body: JSON.stringify(payload),
    });
    // ... rest of code
  }
}

// pages/api/csrf-token.js - NEW
export default (req, res) => {
  const token = require('crypto').randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', 
    `csrf=${token}; HttpOnly; SameSite=Strict; Path=/ `
  );
  res.json({ token });
};

// pages/api/apps-script.js - ADD validation
export default async function handler(req, res) {
  // Validate CSRF token
  const token = req.headers['x-csrf-token'];
  const cookieToken = req.cookies.csrf;
  
  if (!token || token !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  
  // ... rest of code
}
```

---

### Issue #3: Polling Race Condition & Memory Leak
**File:** [pages/meeting/new.js](pages/meeting/new.js#L234)

```javascript
// REPLACE the polling section (around line 234)
const handleFileUpload = async (e) => {
  // ... existing code ...
  
  // ← ADD AbortController
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), 45 * 60 * 1000); // 45 min timeout
  
  try {
    // ... upload code ...
    
    // Step 3: Poll for completion - WITH ABORT & EXPONENTIAL BACKOFF
    let transcript = null;
    let pollInterval = 2000;
    let attempts = 0;
    const maxAttempts = 360; // 45 min / (2s start, exp backoff to 7.5s)

    while (attempts < maxAttempts) {
      try {
        const statusRes = await fetch(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          {
            method: 'GET',
            headers: { 'Authorization': ASSEMBLYAI_KEY },
            signal: abortCtrl.signal, // ← ABORT SUPPORT
          }
        );

        if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'completed') {
          transcript = statusData.text || '';
          break;
        }

        if (statusData.status === 'error') {
          throw new Error(`AssemblyAI error: ${statusData.error}`);
        }

        // Exponential backoff: 2s, 3s, 4s, 5s, 6s, 7.5s
        pollInterval = Math.min(7500, 2000 + attempts * 500);
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('Polling was cancelled');
        }
        throw err;
      }
    }

    if (!transcript) throw new Error('Transcription timed out. Audio may be too long.');
    
    setTranscript(transcript);
    setUploadState('done');
    setError('');
    
  } catch (err) {
    setError('Upload transcription failed: ' + err.message);
    setUploadState('idle');
  } finally {
    clearTimeout(timeoutId);
    // Abort any pending requests
  }
};

// useEffect cleanup - ALREADY GOOD but verify
useEffect(() => {
  return () => {
    // Cleanup on unmount
  };
}, []);
```

---

### Issue #4: XSS Vulnerability - Input Not Sanitized
**File:** [pages/dashboard.js](pages/dashboard.js), [pages/meeting/[id].js](pages/meeting/[id].js)

```bash
npm install dompurify react-html-parser
```

```javascript
// lib/sanitize.js - NEW
import DOMPurify from 'dompurify';

export const sanitize = (dirty) => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: [],
  });
};

// pages/dashboard.js - UPDATE
import { sanitize } from '../lib/sanitize';

// In JSX:
<h2 className={styles.cardTitle}>{sanitize(meeting.title)}</h2>

// OR use dangerouslySetInnerHTML if you trust the data:
// <h2 dangerouslySetInnerHTML={{ __html: sanitize(meeting.title) }} />
```

Also add CSP headers to `next.config.js`:
```javascript
// next.config.js
const nextConfig = {
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
```

---

### Issue #5: No Input Validation Server-Side
**File:** [pages/api/apps-script.js](pages/api/apps-script.js)

```javascript
// Add validation middleware
function validateInput(data, schema) {
  for (const [key, rules] of Object.entries(schema)) {
    const value = data[key];
    if (rules.required && !value) {
      throw new Error(`${key} is required`);
    }
    if (rules.maxLength && String(value).length > rules.maxLength) {
      throw new Error(`${key} exceeds max length of ${rules.maxLength}`);
    }
    if (rules.pattern && !rules.pattern.test(String(value))) {
      throw new Error(`${key} format invalid`);
    }
  }
}

// In API route handlers:
export default async function handler(req, res) {
  try {
    const action = req.query.action;
    
    // Validate based on action
    if (action === 'saveMeeting') {
      validateInput(req.body.meeting, {
        title: { required: true, maxLength: 200 },
        transcript: { required: true, maxLength: 1000000 },
        summary: { maxLength: 10000 },
      });
    }
    
    // ... rest of handler
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
```

---

## WEEK 2 FIXES

### Add Error Boundaries
```javascript
// components/ErrorBoundary.js - NEW
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }

    return this.props.children;
  }
}

// pages/_app.js - USE IT
import ErrorBoundary from '../components/ErrorBoundary';

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
    </AuthProvider>
  );
}
```

---

## FILES MODIFIED
- [ ] `.env.local` - Secrets removed
- [ ] `.gitignore` - Add .env.local
- [ ] `lib/auth.js` - JWT instead of cookie
- [ ] `lib/api.js` - Add CSRF token
- [ ] `pages/api/auth/login.js` - NEW
- [ ] `pages/api/auth/me.js` - NEW
- [ ] `pages/api/csrf-token.js` - NEW
- [ ] `pages/meeting/new.js` - Fix polling with AbortController
- [ ] `lib/sanitize.js` - NEW DOMPurify wrapper
- [ ] `pages/dashboard.js` - Use sanitize()
- [ ] `components/ErrorBoundary.js` - NEW
- [ ] `pages/_app.js` - Add ErrorBoundary

---

## TESTING CHECKLIST
- [ ] API keys successfully revoked
- [ ] New keys working in Vercel
- [ ] Login flow works with JWT
- [ ] CSRF tokens validated
- [ ] Polling aborts on unmount
- [ ] XSS injection blocked
- [ ] Error boundary catches component crashes
- [ ] Input validation rejects invalid data

---

**Next:** After these fixes, proceed to the CODE_AUDIT_REPORT.md for high/medium priority issues.
