# 🧠 StudyBrain AI: Privacy-First In-Browser Notes Summarizer & Multi-Course Workspace

A 100% offline-capable, client-side AI study assistant built with **HTML5**, **CSS3**, **Vanilla JavaScript (ES6+)**, **IndexedDB**, and **Hugging Face Transformers.js**.

---

## 🌟 Key Features

1. **📁 Multi-Course & Notebook Workspace (IndexedDB)**
   - Organize notes by **Course / Subject** (e.g., CS301 - Deep Learning, Biology, History) with custom color tags.
   - Built on a native, promise-based **IndexedDB** database engine (`studybrain_db`), removing the browser's 5MB localStorage limit and supporting gigabytes of academic content.
   - Instant search bar with real-time text matching across note titles, body content, and AI summaries.
   - Collapsible course sidebar with quick keyboard shortcut (`Ctrl+B` or `Cmd+B`).

2. **🔒 100% Client-Side Privacy (No Backend / No API Keys)**
   - Text summarization runs entirely inside your browser using **WebAssembly (WASM)** and **Transformers.js**.
   - Your lecture notes, study cards, and courses never touch any external server or cloud database.

3. **⚡ Non-Blocking Web Worker Architecture**
   - The deep learning model (`Xenova/distilbart-cnn-6-6`) runs in a background thread (`worker.js`).
   - The browser UI stays responsive at 60 FPS without stutter or lag during generation.

4. **🎴 Active-Recall Study Flashcards & Key Bullets**
   - Automatically parses generated summaries into **High-Yield Key Takeaways**.
   - Automatically generates **3D Interactive Flip-Cards** (Click or press Space to flip between Question and Answer) with "Flip All" mode.

5. **💾 Local Persistence, Theming & Data Portability**
   - Auto-saves every keystroke to IndexedDB.
   - Dark & Light mode toggle with CSS custom properties.
   - **Backup & Restore**: Export the entire multi-course workspace into a portable JSON file to back up or migrate between devices.
   - One-click **Copy Summary** and **Export to Markdown (.md)**.

---

## 📁 Project Structure

```text
WEBDEV2/
├── index.html        # Multi-course workspace layout, collapsible sidebar & modal dialogs
├── style.css         # CSS variables, 3D flip-card transforms, sidebar styling & responsive grid
├── script.js         # IndexedDB data engine, UI controller, search, and state manager
├── worker.js         # Dedicated Web Worker running Transformers.js in the background
└── README.md         # Documentation & quick start guide
```

---

## 🚀 How to Run the Project Locally

Because this project uses **Web Workers with ES Modules** (`new Worker('worker.js', { type: 'module' })`) and the **Cache API**, modern browsers require the files to be served via an HTTP server rather than the `file:///` protocol for security reasons.

### Option 1: Using Python (Recommended)
Open PowerShell or your terminal in the `WEBDEV2` folder and run:

```bash
# Python 3
python -m http.server 8000
```
Then open your browser and navigate to:
👉 `http://localhost:8000`

---

### Option 2: Using VS Code Live Server
1. Open the `WEBDEV2` folder in VS Code.
2. Install the **"Live Server"** extension if you haven't already.
3. Right-click `index.html` and click **"Open with Live Server"**.

---

### Option 3: Using Node.js (npx)
```bash
npx serve .
```

---

## 🧠 System Architecture

```
+-------------------------------------------------------------------------+
| Browser Main Thread (script.js)                                         |
| - Course/Notebook dropdown & Color swatch picker                        |
| - Fast IndexedDB queries (Notebooks Store + Notes Store)                |
| - Live search across titles, contents & summaries                       |
| - 3D Active-Recall Flashcard generator                                  |
| - Theme toggle & Keyboard shortcuts (Ctrl+B)                            |
+------------------------------------+------------------------------------+
                                     |
                         postMessage | onmessage
                                     v
+-------------------------------------------------------------------------+
| Background Web Worker (worker.js)                                       |
| - Hugging Face Transformers.js (@xenova/transformers)                   |
| - ONNX Runtime Web (WASM backend)                                       |
| - Model: Xenova/distilbart-cnn-6-6                                      |
| - Automatic caching in browser CacheStorage                             |
+-------------------------------------------------------------------------+
```
