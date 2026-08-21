# PharmaCare Pro — Reference Guide

## 1. Install Prompt (PWA)

**File:** `src/components/InstallPrompt.tsx`

### What it does
Shows an install prompt when a user visits the app in a browser (Chrome/Edge on desktop, Chrome on Android). Users can install the app to their home screen for offline support and faster launch.

### Components

| Component | Purpose |
|---|---|
| `InstallPrompt` (default) | Full-screen modal that appears 1s after page load if install is available |
| `InstallFAB` | Floating action button (bottom-right) — persistent button to trigger install anytime |
| `captureInstallPrompt()` | Call once at app root to capture the `beforeinstallprompt` event |
| `triggerInstall()` | Manually triggers the browser install flow |
| `isInstallReady()` | Returns `true` if install prompt has been captured |
| `detectPlatform()` | Returns `'android'`, `'ios'`, `'desktop'`, or `'other'` |

### Flow
1. `captureInstallPrompt()` is called in the root layout — intercepts the browser's `beforeinstallprompt` event
2. `useInstallState()` hook monitors install readiness
3. If prompt is available and not dismissed/installed → show `InstallPrompt` after 1s delay
4. User taps "Install App" → `triggerInstall()` fires the browser prompt
5. On iOS (no native prompt), shows step-by-step instructions for "Add to Home Screen"
6. After install, `appinstalled` event fires → updates state, hides prompt

### Important states (localStorage)
| Key | Value |
|---|---|
| `pharmacare_installed` | `"true"` — set after successful install |
| `pharmacare_prompt_dismissed` | `"true"` — set when user taps "Not now" |

---

## 2. Mobile Sidebar — Auto-Close on Navigation

**File:** `src/components/layout/Sidebar.tsx`

### Behavior
When a user taps a navigation item on **mobile** (<1024px viewport), the sidebar automatically closes after navigating.

### Code (lines 150-153)
```ts
function handleNavClick(page: Page) {
  navigate(page);
  if (window.innerWidth < 1024) setSidebarOpen(false);
}
```

### Also applies to
- User profile section click (bottom of sidebar) — closes on mobile
- The sidebar slides out using framer-motion spring animation (`stiffness: 300, damping: 30`)

### Breakpoint
- **Mobile:** `<1024px` — overlay sidebar with backdrop, auto-closes on nav
- **Desktop:** `>=1024px` — fixed sidebar (expanded/collapsed), stays open on nav

---

## 3. Startup Script

**File:** `start.bat`

### What it does
Starts the Next.js production server and monitors it every 5 seconds. If the server dies or port 3000 goes down, it is restarted automatically.

### Process Flow
```
start.bat
  ├── Cleanup stale processes (by PID file + port scan)
  ├── Start Node.js server (hidden PowerShell, PID saved to .server.pid)
  ├── Wait for port 3000 (checks every 2s)
  ├── Display status
  └── Monitor loop (every 5 seconds):
       ├── Check Node.js process is alive
       ├── Check port 3000 is listening
       └── If fail → cleanup → restart
```

### Graceful Shutdown
Press **Q** in the console window.

### Auto-Restart
If Node.js server crashes:
1. Kills the process
2. Restarts from scratch
3. Counter tracks number of restarts

### Files Created
| File | Purpose |
|---|---|
| `.server.pid` | PID of Node.js process |

---

## 4. Auto-Start on Boot

Auto-start on boot has been removed. The startup shortcut in the Windows Startup folder has been deleted.

To manually run the application, double-click `start.bat` or use the desktop shortcut.

---

## 5. Quick Reference — Useful Commands

| Action | Command |
|---|---|---|
| Start services | Double-click `start.bat` |
| Stop services | Press **Q** in the start.bat window, or double-click `stop.bat` |
| Check if running | `tasklist \| findstr "node.exe"` |
| Check ports | `netstat -ano \| findstr ":3000"` |
| Build for production | `bun run build` |
| Run in dev mode | `bun run dev` |
| Force kill everything | `stop.bat` |

---

## 6. Architecture Overview

```
[Browser]
       │
       ▼  (http://localhost:3000)
[Next.js Server]  ──  .next/standalone/server.js
       │
       ▼  (API routes in src/app/api/)
[SQLite Database]  ──  db/custom.db (via Prisma ORM)

[Host PC]  ──  start.bat (auto-restart monitor)
```

### Ports
| Port | Service |
|---|---|
| 3000 | Next.js app |
| 81 | Caddy reverse proxy (optional) |
