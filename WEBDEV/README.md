# 🤖 Gesture-Controlled Presentation Deck

A touchless, browser-based presentation deck that lets you navigate slides and control video playback using hand gestures — no plugins, no backend, no installation required.

Built with vanilla HTML/CSS/JavaScript and powered by **Google MediaPipe Hand Landmarker** running entirely in the browser via WebAssembly.

---

## ✨ Features

- **👉 Point Right** — advance to the next slide
- **👈 Point Left** — go back to the previous slide
- **🖐️ Open Palm** — play or pause the demo video
- Real-time hand skeleton overlay drawn on a canvas overlay
- Animated loading screen with progress bar while the AI model downloads
- Click-based button controls as a fallback (no camera required)
- Keyboard shortcuts: `→` / `←` to navigate, `Space` to play/pause
- 1.5-second gesture cooldown to prevent accidental repeat triggers
- Mirrored webcam preview so gestures feel natural (like a mirror)
- Fully responsive — works on mobile with a single-column layout

---

## 🗂️ Project Structure

```
├── index.html      # Markup: slides, loading screen, controls, webcam overlay
├── style.css       # Dark theme, slide transitions, webcam preview, loading bar
├── script.js       # MediaPipe setup, gesture logic, detection loop, drawing
└── mov_bbb.mp4     # Sample video (Big Buck Bunny, open-source)
```

---

## 🚀 Getting Started

### Option 1 — Live Server (recommended)

Because `script.js` uses ES Module imports from a CDN, browsers block it when opened as a plain `file://` URL. Use any local server:

```bash
# VS Code: install the "Live Server" extension, then click "Go Live"

# Node.js
npx serve .

# Python 3
python -m http.server 8080
```

Then open `http://localhost:8080` (or whichever port your server uses).

### Option 2 — Direct file open (Chrome only)

Launch Chrome with the `--allow-file-access-from-files` flag:

```bash
chrome --allow-file-access-from-files index.html
```

---

## 🎮 How to Use

1. Open the page — a loading screen appears while the AI model (~10 MB) downloads from the CDN.
2. Once loaded, read **Slide 1** for a summary of the available gestures.
3. Click **📷 Start Camera** in the bottom control bar and grant webcam permission.
4. Hold your hand up in front of the camera and try the gestures:

| Gesture | Action |
|---|---|
| Index finger extended, pointing to your right | Next slide |
| Index finger extended, pointing to your left | Previous slide |
| All five fingers open (open palm) | Play / Pause video on Slide 4 |

> **Tip:** Keep your hand roughly 30–60 cm from the camera and make deliberate movements. The 1.5-second cooldown prevents accidental double-triggers.

---

## 🧠 How It Works

### Hand Landmark Detection

MediaPipe Hand Landmarker detects **21 key points** (landmarks) on your hand in every video frame. Each landmark has normalized `x`, `y`, `z` coordinates where `(0, 0)` is the top-left corner of the frame.

```
Landmark indices used:
  0  — Wrist
  4  — Thumb tip
  5  — Index MCP (base knuckle)
  8  — Index tip
  9  — Middle MCP
  12 — Middle tip
  13 — Ring MCP
  16 — Ring tip
  17 — Pinky MCP
  20 — Pinky tip
```

### Gesture Math

**Finger extended check:** A finger is extended when its tip's `y` coordinate is at least 0.04 units above its base knuckle (`y` decreases toward the top of the frame).

**Pointing gestures:** The index tip's `x` position is compared to the wrist's `x` position. Because the webcam feed is CSS-mirrored, pointing right on screen means the tip has a *lower* raw `x` value than the wrist (and vice versa for left).

**Open palm:** All four fingers are extended and the thumb tip is more than 0.1 units away from the index MCP along the `x` axis.

### Mirror Flip

Both the `<video>` element and the landmark `<canvas>` are flipped with `transform: scaleX(-1)` in CSS. This makes the preview act like a mirror — your right hand appears on the right side of the screen — without needing to invert the coordinates in JavaScript.

### Cooldown

After any gesture fires, a 1.5-second lock (`COOLDOWN_MS = 1500`) prevents the same or a different gesture from triggering again. This avoids flipping through multiple slides with one slow movement.

---

## 📦 Dependencies

All loaded from CDN — nothing to install.

| Library | Version | Purpose |
|---|---|---|
| [@mediapipe/tasks-vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) | 0.10.14 | Hand landmark detection (WebAssembly) |

The hand landmark model file (`hand_landmarker.task`, ~10 MB) is fetched from `storage.googleapis.com` on first load. It is not bundled with the project.

---

## 🌐 Browser Compatibility

| Browser | Support |
|---|---|
| Chrome 90+ | ✅ Full (GPU delegate enabled) |
| Edge 90+ | ✅ Full |
| Firefox 90+ | ✅ Works (CPU fallback) |
| Safari 15.4+ | ✅ Works |
| Mobile Chrome/Safari | ✅ Responsive layout included |

> MediaPipe prefers GPU acceleration (`delegate: "GPU"`) and falls back to CPU automatically on unsupported hardware.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `→` Arrow Right | Next slide |
| `←` Arrow Left | Previous slide |
| `Space` | Play / Pause video |

---

## 📝 Slides Overview

| # | Title | Content |
|---|---|---|
| 1 | Introduction | Gesture reference card and quick-start instructions |
| 2 | How It Works | Cards explaining the AI model, gesture math, cooldown, and mirror view |
| 3 | Hand Landmarks | Inline SVG diagram of all 21 MediaPipe landmark points |
| 4 | Live Demo | Embedded video (Big Buck Bunny) controlled by the Open Palm gesture |

---

## 🔧 Configuration

Key constants at the top of `script.js`:

```js
const COOLDOWN_MS      = 1500;  // ms to wait between gestures
const POINT_THRESHOLD  = 0.08;  // min horizontal distance for a "point" gesture
```

Increasing `POINT_THRESHOLD` makes pointing gestures require a more exaggerated movement. Increasing `COOLDOWN_MS` gives more time between actions.

---

## 📄 License

The source code is released under the [MIT License](https://opensource.org/licenses/MIT).

The sample video (`mov_bbb.mp4`) is a clip from [Big Buck Bunny](https://peach.blender.org/), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) by the Blender Foundation.
