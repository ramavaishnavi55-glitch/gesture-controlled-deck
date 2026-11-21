/**
 * ============================================================================
 * script.js - Application Orchestrator, IndexedDB Engine & Multi-Notebook UI
 * ============================================================================
 * 
 * ARCHITECTURE OVERVIEW:
 * 1. IndexedDB Layer: Persistent, high-capacity client-side database for
 *    Notebooks (Courses) and Lecture Notes (eliminating the 5MB localStorage cap).
 * 2. Background AI Worker: Decoupled Web Worker running Transformers.js.
 * 3. Reactive State Management: Active notebook/note lifecycle with debounced auto-save.
 * 4. Active-Recall Study Tools: Dynamic bullet extraction & 3D flip-card generator.
 * 5. Data Portability: Complete workspace JSON export & import.
 */

// ============================================================================
// 1. INDEXEDDB DATABASE ENGINE (Native Promise-Based Wrapper)
// ============================================================================
const DB_NAME = 'studybrain_db';
const DB_VERSION = 1;
const STORES = {
  NOTEBOOKS: 'notebooks',
  NOTES: 'notes'
};

let dbInstance = null;

/**
 * Initializes and upgrades the IndexedDB database
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store 1: Notebooks (Courses/Subjects)
      if (!db.objectStoreNames.contains(STORES.NOTEBOOKS)) {
        db.createObjectStore(STORES.NOTEBOOKS, { keyPath: 'id' });
      }

      // Store 2: Individual Lecture Notes
      if (!db.objectStoreNames.contains(STORES.NOTES)) {
        const notesStore = db.createObjectStore(STORES.NOTES, { keyPath: 'id' });
        // Indexes for lightning-fast queries by course and recency
        notesStore.createIndex('notebookId', 'notebookId', { unique: false });
        notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[IndexedDB Error]:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Generic IndexedDB CRUD operations wrapped in Promises
 */
function dbPut(storeName, data) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGet(storeName, key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGetAll(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbDelete(storeName, key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGetNotesByNotebook(notebookId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORES.NOTES, 'readonly');
      const store = tx.objectStore(STORES.NOTES);
      const index = store.index('notebookId');
      const req = index.getAll(IDBKeyRange.only(notebookId));
      req.onsuccess = () => {
        const notes = req.result || [];
        // Sort notes by updatedAt descending (most recent first)
        notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(notes);
      };
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbDeleteNotesByNotebook(notebookId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORES.NOTES, 'readwrite');
      const store = tx.objectStore(STORES.NOTES);
      const index = store.index('notebookId');
      const req = index.openCursor(IDBKeyRange.only(notebookId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================================
// 2. DOM ELEMENT SELECTORS
// ============================================================================
// Sidebar & Navigation
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const appSidebar = document.getElementById('appSidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const activeNotebookDot = document.getElementById('activeNotebookDot');
const notebookSelect = document.getElementById('notebookSelect');
const addNotebookBtn = document.getElementById('addNotebookBtn');
const deleteNotebookBtn = document.getElementById('deleteNotebookBtn');
const searchNotesInput = document.getElementById('searchNotesInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const newNoteBtn = document.getElementById('newNoteBtn');
const notesListContainer = document.getElementById('notesListContainer');
const notesCountBadge = document.getElementById('notesCountBadge');

// Workspace Backup & Restore
const exportWorkspaceBtn = document.getElementById('exportWorkspaceBtn');
const importWorkspaceBtn = document.getElementById('importWorkspaceBtn');
const restoreFileInput = document.getElementById('restoreFileInput');

// Theme & Progress Bar
const themeToggleBtn = document.getElementById('themeToggleBtn');
const modelProgressContainer = document.getElementById('modelProgressContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercentage = document.getElementById('progressPercentage');
const progressStatusLabel = document.getElementById('progressStatusLabel');
const progressDetailLabel = document.getElementById('progressDetailLabel');

// Notes Input Panel
const noteTitleInput = document.getElementById('noteTitleInput');
const notesInput = document.getElementById('notesInput');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const clearNotesBtn = document.getElementById('clearNotesBtn');
const wordCountEl = document.getElementById('wordCount');
const charCountEl = document.getElementById('charCount');
const readTimeEl = document.getElementById('readTime');
const saveStatusIndicator = document.getElementById('saveStatusIndicator');

// Document / PDF Upload & Drag-and-Drop
const uploadPdfBtn = document.getElementById('uploadPdfBtn');
const pdfFileInput = document.getElementById('pdfFileInput');
const textareaContainer = document.getElementById('textareaContainer');
const dropZoneOverlay = document.getElementById('dropZoneOverlay');
const pdfParseProgressBanner = document.getElementById('pdfParseProgressBanner');
const pdfParseStatusText = document.getElementById('pdfParseStatusText');

// Generation Controls
const summaryLengthSelect = document.getElementById('summaryLengthSelect');
const summarizeBtn = document.getElementById('summarizeBtn');
const summarizeBtnText = document.getElementById('summarizeBtnText');

// Output Tabs & Content
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const flashcardCountBadge = document.getElementById('flashcardCountBadge');

const emptySummaryState = document.getElementById('emptySummaryState');
const activeSummaryContent = document.getElementById('activeSummaryContent');
const summaryTextOutput = document.getElementById('summaryTextOutput');
const compressionRatio = document.getElementById('compressionRatio');

const emptyBulletsState = document.getElementById('emptyBulletsState');
const activeBulletsContent = document.getElementById('activeBulletsContent');
const bulletsList = document.getElementById('bulletsList');

const emptyFlashcardsState = document.getElementById('emptyFlashcardsState');
const activeFlashcardsContent = document.getElementById('activeFlashcardsContent');
const flashcardsGrid = document.getElementById('flashcardsGrid');
const flipAllCardsBtn = document.getElementById('flipAllCardsBtn');

const copySummaryBtn = document.getElementById('copySummaryBtn');
const copyBtnText = document.getElementById('copyBtnText');
const downloadNotesBtn = document.getElementById('downloadNotesBtn');

// New Notebook Modal
const newNotebookModal = document.getElementById('newNotebookModal');
const notebookNameInput = document.getElementById('notebookNameInput');
const colorPalette = document.getElementById('colorPalette');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const saveNotebookBtn = document.getElementById('saveNotebookBtn');

// ============================================================================
// 3. APPLICATION STATE
// ============================================================================
const state = {
  notebooks: [],
  activeNotebookId: null,
  notes: [],
  activeNoteId: null,
  activeNote: null,
  searchQuery: '',
  selectedModalColor: '#6366f1',
  allFlippedState: false,
  autoSaveTimer: null,
  isSummarizing: false
};

const STORAGE_KEYS = {
  THEME: 'studybrain_user_theme',
  ACTIVE_NOTEBOOK: 'studybrain_active_notebook_id',
  ACTIVE_NOTE: 'studybrain_active_note_id',
  SIDEBAR_COLLAPSED: 'studybrain_sidebar_collapsed'
};

// ============================================================================
// 4. BACKGROUND AI WEB WORKER SETUP
// ============================================================================
let aiWorker = null;

function initializeWorker() {
  try {
    aiWorker = new Worker('worker.js', { type: 'module' });

    aiWorker.onmessage = handleWorkerMessage;

    aiWorker.onerror = (error) => {
      console.error('[Worker Error]:', error);
      handleWorkerError(
        'Unable to initialize Web Worker. Note: Browsers block ES Module workers ' +
        'when opened via file:// URL. Please run via a local web server (e.g. VS Code Live Server or "python -m http.server 8000").'
      );
    };

    console.log('[StudyBrain AI] Web Worker initialized successfully.');
  } catch (err) {
    console.error('[App] Failed to spawn worker:', err);
    handleWorkerError(err.message);
  }
}

function handleWorkerMessage(event) {
  const { type, status, message, data, summary, error } = event.data;

  switch (type) {
    case 'status':
      updateUIStatus(status, message);
      break;

    case 'download_progress':
      updateDownloadProgress(data);
      break;

    case 'complete':
      handleGenerationComplete(summary);
      break;

    case 'error':
      handleWorkerError(error);
      break;
  }
}

function updateDownloadProgress(data) {
  modelProgressContainer.classList.remove('hidden');

  if (data.status === 'initiate') {
    progressStatusLabel.textContent = `Downloading ${data.file || 'model components'}...`;
  } else if (data.status === 'progress') {
    const percent = Math.round(data.progress || 0);
    progressBarFill.style.width = `${percent}%`;
    progressPercentage.textContent = `${percent}%`;
    progressStatusLabel.textContent = `Downloading ${data.file || 'AI model'} (${percent}%)`;
    progressDetailLabel.textContent = `Downloaded: ${(data.loaded / (1024 * 1024)).toFixed(1)} MB / ${(data.total / (1024 * 1024)).toFixed(1)} MB`;
  } else if (data.status === 'done') {
    progressStatusLabel.textContent = `Cached: ${data.file || 'Component complete'}`;
  } else if (data.status === 'ready') {
    progressBarFill.style.width = '100%';
    progressPercentage.textContent = '100%';
    progressStatusLabel.textContent = 'AI Model Ready in Cache!';
    setTimeout(() => {
      modelProgressContainer.classList.add('hidden');
    }, 2000);
  }
}

function updateUIStatus(status, message) {
  if (status === 'loading_model') {
    summarizeBtn.disabled = true;
    summarizeBtnText.textContent = 'Loading Model...';
  } else if (status === 'generating') {
    summarizeBtn.disabled = true;
    summarizeBtnText.textContent = 'Summarizing Notes...';
    summarizeBtn.style.opacity = '0.85';
  } else if (status === 'ready') {
    summarizeBtn.disabled = false;
    summarizeBtnText.textContent = 'Summarize Notes';
  }
}

function handleWorkerError(errorMsg) {
  console.error('[AI Processing Error]:', errorMsg);
  state.isSummarizing = false;
  summarizeBtn.disabled = false;
  summarizeBtnText.textContent = 'Summarize Notes';
  summarizeBtn.style.opacity = '1';
  modelProgressContainer.classList.add('hidden');

  let alertMessage = `⚠️ AI Generation Notice:\n\n${errorMsg}`;
  if (window.location.protocol === 'file:') {
    alertMessage += '\n\n💡 Tip: You are opening this via file://. Modern browsers restrict Web Workers and Cache API on raw local files. Please run a local web server (e.g. VS Code Live Server or "python -m http.server 8000")!';
  }
  alert(alertMessage);
}

// ============================================================================
// 5. DATABASE INITIALIZATION & LOCALSTORAGE MIGRATION
// ============================================================================

/**
 * Checks for previous localStorage data and seeds database on first launch
 */
async function initializeDataLayer() {
  await openDatabase();

  const existingNotebooks = await dbGetAll(STORES.NOTEBOOKS);

  // First run: Check for legacy localStorage data or seed with sample course
  if (existingNotebooks.length === 0) {
    const defaultNotebook = {
      id: 'nb_general',
      name: 'General Studies',
      color: '#6366f1',
      createdAt: Date.now()
    };
    await dbPut(STORES.NOTEBOOKS, defaultNotebook);

    // Check if user has notes from previous version stored in localStorage
    const legacyNotes = localStorage.getItem('studybrain_notes_input');
    const legacySummary = localStorage.getItem('studybrain_summary_output');
    const legacyBullets = localStorage.getItem('studybrain_bullets_output');
    const legacyFlashcards = localStorage.getItem('studybrain_flashcards_output');

    if (legacyNotes && legacyNotes.trim().length > 0) {
      console.log('[Migration] Transferring legacy localStorage notes to IndexedDB...');
      let bullets = [];
      let flashcards = [];
      try { if (legacyBullets) bullets = JSON.parse(legacyBullets); } catch (e) {}
      try { if (legacyFlashcards) flashcards = JSON.parse(legacyFlashcards); } catch (e) {}

      const migratedNote = {
        id: 'note_' + Date.now(),
        notebookId: 'nb_general',
        title: 'Migrated Lecture Note',
        content: legacyNotes,
        summary: legacySummary || '',
        bullets: bullets,
        flashcards: flashcards,
        summaryLength: localStorage.getItem('studybrain_summary_length') || 'medium',
        wordCount: calculateWordCount(legacyNotes),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await dbPut(STORES.NOTES, migratedNote);

      // Clean up legacy localStorage keys to free space
      localStorage.removeItem('studybrain_notes_input');
      localStorage.removeItem('studybrain_summary_output');
      localStorage.removeItem('studybrain_bullets_output');
      localStorage.removeItem('studybrain_flashcards_output');
    } else {
      // Seed rich university starter lecture note
      await seedStarterNote(defaultNotebook.id);
    }
  }

  // Load notebooks into application state
  await reloadNotebooksList();
}

/**
 * Seeds a high-yield computer science sample note
 */
async function seedStarterNote(notebookId) {
  const starterNote = {
    id: 'note_seed_nn',
    notebookId: notebookId,
    title: 'CS301: Deep Learning & Neural Architectures',
    content: 
`Course: CS301 - Deep Learning & Neural Architectures
Topic: Foundations of Artificial Neural Networks and Gradient Descent

Artificial Neural Networks (ANNs) are computational models inspired by biological neural networks in the human brain. Biological neurons consist of dendrites that receive signals, a soma that computes input potentials, and an axon that propagates action potentials via synapses. In artificial counterparts, inputs are multiplied by adaptive scalar weights, aggregated through a summation junction along with a bias term, and passed through a non-linear activation function.

Non-linear activation functions such as ReLU (Rectified Linear Unit), Sigmoid, and GELU are crucial because they empower the network to approximate complex non-linear functions; without them, cascading multiple layers would simply collapse into a single linear transformation regardless of depth.

During supervised training, the network measures prediction errors via a loss function (such as Mean Squared Error for regression or Cross-Entropy for multi-class classification). The optimization process uses the Backpropagation algorithm, which computes the partial derivatives of the loss with respect to every weight using the calculus chain rule. These gradients dictate how weights are iteratively updated via Stochastic Gradient Descent (SGD) or the Adam optimizer to minimize overall loss.

Modern advancements have enabled edge AI, allowing neural models to execute directly within client devices and web browsers using WebAssembly (WASM) and WebGPU. Running models locally preserves user data privacy, eliminates server operational costs, and facilitates instant inference without continuous network latency.`,
    summary: '',
    bullets: [],
    flashcards: [],
    summaryLength: 'medium',
    wordCount: 224,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await dbPut(STORES.NOTES, starterNote);
}

// ============================================================================
// 6. NOTEBOOK & COURSE CONTROLLERS
// ============================================================================

/**
 * Reloads all notebooks from IndexedDB and populates the dropdown
 */
async function reloadNotebooksList() {
  state.notebooks = await dbGetAll(STORES.NOTEBOOKS);
  state.notebooks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // Determine active notebook
  const savedActiveNbId = localStorage.getItem(STORAGE_KEYS.ACTIVE_NOTEBOOK);
  if (savedActiveNbId && state.notebooks.some(nb => nb.id === savedActiveNbId)) {
    state.activeNotebookId = savedActiveNbId;
  } else if (state.notebooks.length > 0) {
    state.activeNotebookId = state.notebooks[0].id;
  } else {
    state.activeNotebookId = null;
  }

  renderNotebookSelector();
  await reloadNotesForActiveNotebook();
}

/**
 * Populates the course dropdown and updates color dot
 */
function renderNotebookSelector() {
  notebookSelect.innerHTML = '';

  state.notebooks.forEach(nb => {
    const opt = document.createElement('option');
    opt.value = nb.id;
    opt.textContent = nb.name;
    if (nb.id === state.activeNotebookId) {
      opt.selected = true;
    }
    notebookSelect.appendChild(opt);
  });

  const activeNb = state.notebooks.find(nb => nb.id === state.activeNotebookId);
  if (activeNb) {
    activeNotebookDot.style.backgroundColor = activeNb.color || '#6366f1';
  }
}

/**
 * Creates a new notebook / course
 */
async function handleCreateNotebook() {
  const name = notebookNameInput.value.trim();
  if (!name) {
    alert('Please enter a name for the course or notebook.');
    notebookNameInput.focus();
    return;
  }

  const newNb = {
    id: 'nb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    name: name,
    color: state.selectedModalColor || '#6366f1',
    createdAt: Date.now()
  };

  await dbPut(STORES.NOTEBOOKS, newNb);

  // Switch to the newly created notebook
  state.activeNotebookId = newNb.id;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTEBOOK, newNb.id);

  // Create an initial blank note in this new course
  const firstNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    notebookId: newNb.id,
    title: 'Lecture 1: Introduction',
    content: '',
    summary: '',
    bullets: [],
    flashcards: [],
    summaryLength: 'medium',
    wordCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await dbPut(STORES.NOTES, firstNote);

  closeNotebookModal();
  await reloadNotebooksList();
  selectNote(firstNote.id);
}

/**
 * Deletes the active notebook and its associated notes
 */
async function handleDeleteActiveNotebook() {
  if (state.notebooks.length <= 1) {
    alert('Cannot delete the only notebook. You must have at least one active course or notebook.');
    return;
  }

  const activeNb = state.notebooks.find(nb => nb.id === state.activeNotebookId);
  const confirmMsg = `Are you sure you want to delete "${activeNb?.name || 'this notebook'}"?\n\nThis will permanently delete all lecture notes and flashcards inside it!`;
  
  if (confirm(confirmMsg)) {
    // Delete all notes in this notebook
    await dbDeleteNotesByNotebook(state.activeNotebookId);
    // Delete the notebook itself
    await dbDelete(STORES.NOTEBOOKS, state.activeNotebookId);

    // Switch to another notebook
    const remaining = state.notebooks.filter(nb => nb.id !== state.activeNotebookId);
    state.activeNotebookId = remaining[0]?.id || null;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTEBOOK, state.activeNotebookId);

    await reloadNotebooksList();
  }
}

// ============================================================================
// 7. LECTURE NOTES CONTROLLER & REACTIVE SIDEBAR
// ============================================================================

/**
 * Fetches notes for the active notebook, filters by search query, and renders sidebar list
 */
async function reloadNotesForActiveNotebook() {
  if (!state.activeNotebookId) {
    state.notes = [];
    renderNotesList();
    return;
  }

  let notes = await dbGetNotesByNotebook(state.activeNotebookId);
  state.notes = notes;

  // Apply search query filter if active
  const query = state.searchQuery.trim().toLowerCase();
  let filteredNotes = notes;
  if (query) {
    filteredNotes = notes.filter(n => 
      (n.title && n.title.toLowerCase().includes(query)) ||
      (n.content && n.content.toLowerCase().includes(query)) ||
      (n.summary && n.summary.toLowerCase().includes(query))
    );
  }

  renderNotesList(filteredNotes);

  // If no note is selected, or selected note was deleted, select the first one
  const targetNote = notes.find(n => n.id === state.activeNoteId);
  if (!targetNote && notes.length > 0) {
    selectNote(notes[0].id);
  } else if (notes.length === 0) {
    // Create an empty starter note if notebook is empty
    await createNewNote();
  }
}

/**
 * Renders note cards into the sidebar
 */
function renderNotesList(notesToRender = state.notes) {
  notesListContainer.innerHTML = '';
  notesCountBadge.textContent = `${notesToRender.length} note${notesToRender.length === 1 ? '' : 's'}`;

  if (notesToRender.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty-state';
    empty.textContent = state.searchQuery ? 'No matching notes found.' : 'No notes in this course yet.';
    notesListContainer.appendChild(empty);
    return;
  }

  notesToRender.forEach(note => {
    const item = document.createElement('div');
    item.className = `note-item ${note.id === state.activeNoteId ? 'active' : ''}`;
    item.setAttribute('data-id', note.id);

    const titleText = note.title ? escapeHtml(note.title) : 'Untitled Note';
    const previewText = note.content 
      ? escapeHtml(note.content.substring(0, 55).replace(/\n/g, ' ') + (note.content.length > 55 ? '...' : '')) 
      : 'Empty note...';
    
    const formattedDate = formatRelativeTime(note.updatedAt || note.createdAt);

    item.innerHTML = `
      <div class="note-item-header">
        <span class="note-item-title" title="${titleText}">${titleText}</span>
        <button class="note-item-delete-btn" title="Delete note" aria-label="Delete note">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      <p class="note-item-snippet">${previewText}</p>
      <div class="note-item-meta">
        <span>${formattedDate}</span>
        <span class="note-item-meta-tag">${note.wordCount || 0} words</span>
      </div>
    `;

    // Note selection listener
    item.addEventListener('click', (e) => {
      // Ignore click if clicking the delete button
      if (e.target.closest('.note-item-delete-btn')) return;
      selectNote(note.id);
      // On mobile, close sidebar after selecting note
      if (window.innerWidth <= 960) {
        toggleSidebar(false);
      }
    });

    // Delete note listener
    const deleteBtn = item.querySelector('.note-item-delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(note.id);
    });

    notesListContainer.appendChild(item);
  });
}

/**
 * Creates a new blank lecture note
 */
async function createNewNote() {
  if (!state.activeNotebookId) return;

  // Flush any pending changes to current note
  await flushActiveNoteSave();

  const newNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    notebookId: state.activeNotebookId,
    title: 'Untitled Lecture Note',
    content: '',
    summary: '',
    bullets: [],
    flashcards: [],
    summaryLength: 'medium',
    wordCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await dbPut(STORES.NOTES, newNote);
  await reloadNotesForActiveNotebook();
  selectNote(newNote.id);

  // Focus the title input for fast entry
  setTimeout(() => {
    noteTitleInput.focus();
    noteTitleInput.select();
  }, 100);
}

/**
 * Loads a selected note into the left and right workspace panels
 */
async function selectNote(noteId) {
  // If clicking already active note, do nothing
  if (state.activeNoteId === noteId && state.activeNote) return;

  // Save current note before switching
  await flushActiveNoteSave();

  const note = await dbGet(STORES.NOTES, noteId);
  if (!note) return;

  state.activeNoteId = note.id;
  state.activeNote = note;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTE, note.id);

  // Update active style in sidebar
  const items = notesListContainer.querySelectorAll('.note-item');
  items.forEach(el => {
    if (el.getAttribute('data-id') === note.id) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Populate Left Panel (Input)
  noteTitleInput.value = note.title || '';
  notesInput.value = note.content || '';
  summaryLengthSelect.value = note.summaryLength || 'medium';
  updateLiveCounters();

  // Populate Right Panel (Summary, Bullets, Flashcards)
  if (note.summary && note.summary.trim().length > 0) {
    emptySummaryState.classList.add('hidden');
    activeSummaryContent.classList.remove('hidden');
    summaryTextOutput.textContent = note.summary;

    const originalWords = note.wordCount || calculateWordCount(note.content);
    const summaryWords = calculateWordCount(note.summary);
    if (originalWords > 0) {
      const savedPercent = Math.max(0, Math.round((1 - (summaryWords / originalWords)) * 100));
      compressionRatio.textContent = `${savedPercent}% condensed (${summaryWords} words vs ${originalWords} original)`;
    }

    renderBulletPoints(note.bullets || []);
    renderFlashcards(note.flashcards || []);
  } else {
    // Show empty states
    emptySummaryState.classList.remove('hidden');
    activeSummaryContent.classList.add('hidden');
    summaryTextOutput.textContent = '';

    emptyBulletsState.classList.remove('hidden');
    activeBulletsContent.classList.add('hidden');
    bulletsList.innerHTML = '';

    emptyFlashcardsState.classList.remove('hidden');
    activeFlashcardsContent.classList.add('hidden');
    flashcardsGrid.innerHTML = '';
    flashcardCountBadge.textContent = '0';
  }
}

/**
 * Deletes a note by ID with confirmation
 */
async function deleteNote(noteId) {
  const noteToDelete = state.notes.find(n => n.id === noteId);
  const confirmMsg = `Delete "${noteToDelete?.title || 'this note'}"?`;

  if (confirm(confirmMsg)) {
    await dbDelete(STORES.NOTES, noteId);

    if (state.activeNoteId === noteId) {
      state.activeNoteId = null;
      state.activeNote = null;
    }

    await reloadNotesForActiveNotebook();
  }
}

// ============================================================================
// 8. REAL-TIME AUTO-SAVE & INPUT TRACKING
// ============================================================================

/**
 * Debounced auto-save function called on every input stroke
 */
function handleNoteInput() {
  updateLiveCounters();

  if (!state.activeNote) return;

  saveStatusIndicator.textContent = 'Saving...';
  saveStatusIndicator.style.opacity = '1';

  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(async () => {
    await flushActiveNoteSave();
  }, 400);
}

/**
 * Saves current active note fields into IndexedDB and updates sidebar preview
 */
async function flushActiveNoteSave() {
  if (!state.activeNote || !state.activeNoteId) return;

  const currentTitle = noteTitleInput.value.trim() || 'Untitled Lecture Note';
  const currentContent = notesInput.value;
  const wordCount = calculateWordCount(currentContent);

  state.activeNote.title = currentTitle;
  state.activeNote.content = currentContent;
  state.activeNote.wordCount = wordCount;
  state.activeNote.summaryLength = summaryLengthSelect.value;
  state.activeNote.updatedAt = Date.now();

  await dbPut(STORES.NOTES, state.activeNote);

  saveStatusIndicator.textContent = 'Saved in IndexedDB ✓';

  // Fast inline update of active note card in sidebar without full re-render
  const activeCard = notesListContainer.querySelector(`.note-item[data-id="${state.activeNote.id}"]`);
  if (activeCard) {
    const titleEl = activeCard.querySelector('.note-item-title');
    const snippetEl = activeCard.querySelector('.note-item-snippet');
    const metaTagEl = activeCard.querySelector('.note-item-meta-tag');
    if (titleEl) titleEl.textContent = currentTitle;
    if (snippetEl) {
      snippetEl.textContent = currentContent 
        ? currentContent.substring(0, 55).replace(/\n/g, ' ') + (currentContent.length > 55 ? '...' : '') 
        : 'Empty note...';
    }
    if (metaTagEl) metaTagEl.textContent = `${wordCount} words`;
  }
}

function updateLiveCounters() {
  const text = notesInput.value;
  const chars = text.length;
  const words = calculateWordCount(text);
  const readTimeMin = Math.max(1, Math.ceil(words / 200));

  wordCountEl.textContent = words.toLocaleString();
  charCountEl.textContent = chars.toLocaleString();
  readTimeEl.textContent = words > 0 ? `${readTimeMin} min read` : '0 min read';
}

function calculateWordCount(str) {
  if (!str) return 0;
  return str.trim() === '' ? 0 : str.trim().split(/\s+/).filter(Boolean).length;
}

// ============================================================================
// 9. CLIENT-SIDE AI SUMMARIZATION & STUDY TOOLS
// ============================================================================

/**
 * Triggers the Web Worker summarization routine
 */
function triggerSummarization() {
  const text = notesInput.value.trim();
  const words = calculateWordCount(text);

  if (words < 15) {
    alert('Please enter at least 15-20 words of lecture notes so the AI model has enough context to produce a summary.');
    notesInput.focus();
    return;
  }

  // Token boundary options
  const lengthMode = summaryLengthSelect.value;
  let tokenOptions = { maxTokens: 130, minTokens: 40 };

  if (lengthMode === 'short') {
    tokenOptions = { maxTokens: 60, minTokens: 20 };
  } else if (lengthMode === 'detailed') {
    tokenOptions = { maxTokens: 240, minTokens: 80 };
  }

  state.isSummarizing = true;
  summarizeBtn.disabled = true;
  summarizeBtnText.textContent = 'Running Local AI...';

  aiWorker.postMessage({
    action: 'summarize',
    text: text,
    options: tokenOptions
  });
}

/**
 * Handles completed summary from Web Worker:
 * 1. Generates Key Bullets
 * 2. Generates 3D Study Flashcards
 * 3. Persists results to active note in IndexedDB
 */
async function handleGenerationComplete(summaryText) {
  state.isSummarizing = false;
  summarizeBtn.disabled = false;
  summarizeBtnText.textContent = 'Summarize Notes';
  summarizeBtn.style.opacity = '1';
  modelProgressContainer.classList.add('hidden');

  if (!summaryText) {
    summaryText = 'No summary could be generated. Please try providing more lecture notes.';
  }

  // 1. Display Summary
  emptySummaryState.classList.add('hidden');
  activeSummaryContent.classList.remove('hidden');
  summaryTextOutput.textContent = summaryText;

  // Compression statistics
  const originalWords = calculateWordCount(notesInput.value);
  const summaryWords = calculateWordCount(summaryText);
  if (originalWords > 0) {
    const savedPercent = Math.max(0, Math.round((1 - (summaryWords / originalWords)) * 100));
    compressionRatio.textContent = `${savedPercent}% condensed (${summaryWords} words vs ${originalWords} original)`;
  }

  // 2. Generate and Render Bullets
  const bulletPoints = extractBulletPoints(summaryText);
  renderBulletPoints(bulletPoints);

  // 3. Generate and Render Flashcards
  const flashcards = generateFlashcards(summaryText, bulletPoints);
  renderFlashcards(flashcards);

  // 4. Save directly into Active Note in IndexedDB
  if (state.activeNote) {
    state.activeNote.summary = summaryText;
    state.activeNote.bullets = bulletPoints;
    state.activeNote.flashcards = flashcards;
    state.activeNote.summaryLength = summaryLengthSelect.value;
    state.activeNote.updatedAt = Date.now();
    await dbPut(STORES.NOTES, state.activeNote);
    saveStatusIndicator.textContent = 'Saved in IndexedDB ✓';
  }
}

/**
 * Splits summary prose into high-yield study bullets
 */
function extractBulletPoints(summaryText) {
  const sentences = summaryText
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  return sentences.length > 0 ? sentences : [summaryText];
}

function renderBulletPoints(bullets) {
  if (!bullets || bullets.length === 0) {
    emptyBulletsState.classList.remove('hidden');
    activeBulletsContent.classList.add('hidden');
    bulletsList.innerHTML = '';
    return;
  }

  emptyBulletsState.classList.add('hidden');
  activeBulletsContent.classList.remove('hidden');
  bulletsList.innerHTML = '';

  bullets.forEach((point, index) => {
    const li = document.createElement('li');
    li.className = 'study-bullet-item';
    li.innerHTML = `
      <span class="bullet-number">${index + 1}</span>
      <div class="bullet-text">${escapeHtml(point)}</div>
    `;
    bulletsList.appendChild(li);
  });
}

/**
 * Transforms summary points into active-recall question/answer flashcards
 */
function generateFlashcards(summaryText, bullets) {
  const cards = [];

  bullets.forEach((sentence, index) => {
    let question = '';
    let answer = sentence;

    // Active-recall heuristic parsing
    const definitionMatch = sentence.match(/^([^.,:;]+?)\s+(is defined as|refers to|is a|is an|enables|helps|acts as|consists of)\s+(.*)/i);

    if (definitionMatch) {
      const subject = definitionMatch[1].trim();
      question = `What is the role and definition of "${subject}"?`;
    } else if (sentence.toLowerCase().includes('because') || sentence.toLowerCase().includes('due to')) {
      question = `Key Cause & Effect (Concept #${index + 1}): Why does this process occur?`;
    } else {
      question = `Key Takeaway #${index + 1}: What core principle is explained here?`;
    }

    cards.push({
      id: index + 1,
      question: question,
      answer: answer
    });
  });

  return cards;
}

function renderFlashcards(cards) {
  flashcardCountBadge.textContent = cards ? cards.length : 0;

  if (!cards || cards.length === 0) {
    emptyFlashcardsState.classList.remove('hidden');
    activeFlashcardsContent.classList.add('hidden');
    flashcardsGrid.innerHTML = '';
    return;
  }

  emptyFlashcardsState.classList.add('hidden');
  activeFlashcardsContent.classList.remove('hidden');
  flashcardsGrid.innerHTML = '';

  cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'flashcard';
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('tabindex', '0');
    cardEl.setAttribute('aria-label', `Flashcard ${card.id}: Click to flip`);

    cardEl.innerHTML = `
      <div class="flashcard-inner">
        <!-- Front Side: Question / Prompt -->
        <div class="flashcard-face flashcard-front">
          <div class="card-header-tag">
            <span>Card ${card.id}</span>
            <span class="card-flip-prompt">Click to Flip 🔄</span>
          </div>
          <div class="card-body-text">
            <strong>${escapeHtml(card.question)}</strong>
          </div>
          <div class="card-footer-tip">Active Recall Mode</div>
        </div>

        <!-- Back Side: Detailed Answer / Explanation -->
        <div class="flashcard-face flashcard-back">
          <div class="card-header-tag">
            <span>Answer / Insight</span>
            <span class="card-flip-prompt">Click to Flip 🔄</span>
          </div>
          <div class="card-body-text">
            ${escapeHtml(card.answer)}
          </div>
          <div class="card-footer-tip">Verified from Notes ✓</div>
        </div>
      </div>
    `;

    // Click to flip
    cardEl.addEventListener('click', () => {
      cardEl.classList.toggle('is-flipped');
    });

    // Keyboard support (Space/Enter)
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cardEl.classList.toggle('is-flipped');
      }
    });

    flashcardsGrid.appendChild(cardEl);
  });
}

function toggleFlipAllCards() {
  state.allFlippedState = !state.allFlippedState;
  const cards = flashcardsGrid.querySelectorAll('.flashcard');
  cards.forEach(card => {
    if (state.allFlippedState) {
      card.classList.add('is-flipped');
    } else {
      card.classList.remove('is-flipped');
    }
  });
  flipAllCardsBtn.textContent = state.allFlippedState ? 'Show Questions' : 'Flip All';
}

// ============================================================================
// 10. WORKSPACE BACKUP & RESTORE (PORTABILITY)
// ============================================================================

/**
 * Exports all courses and notes into a portable JSON backup file
 */
async function exportWorkspaceBackup() {
  try {
    const allNotebooks = await dbGetAll(STORES.NOTEBOOKS);
    const allNotes = await dbGetAll(STORES.NOTES);

    const backupPayload = {
      app: 'StudyBrain AI',
      version: 1,
      exportedAt: new Date().toISOString(),
      notebooks: allNotebooks,
      notes: allNotes
    };

    const jsonStr = JSON.stringify(backupPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyBrain_Workspace_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Backup export failed:', err);
    alert('Failed to export workspace backup.');
  }
}

/**
 * Imports a JSON backup file and restores courses and notes
 */
async function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.notebooks || !data.notes) {
      alert('Invalid backup file. Missing notebooks or notes data.');
      return;
    }

    if (confirm(`Restore ${data.notebooks.length} courses and ${data.notes.length} notes? This will merge with your current workspace.`)) {
      for (const nb of data.notebooks) {
        await dbPut(STORES.NOTEBOOKS, nb);
      }
      for (const note of data.notes) {
        await dbPut(STORES.NOTES, note);
      }

      alert('Workspace successfully restored from backup! ✓');
      await reloadNotebooksList();
    }
  } catch (err) {
    console.error('Restore failed:', err);
    alert('Failed to read or restore backup file: ' + err.message);
  } finally {
    event.target.value = ''; // Reset input
  }
}

// ============================================================================
// 11. SIDEBAR COLLAPSE, MODALS & THEME CONTROLLER
// ============================================================================

function toggleSidebar(forceState = null) {
  const isCurrentlyCollapsed = appSidebar.classList.contains('collapsed');
  const shouldCollapse = forceState !== null ? !forceState : !isCurrentlyCollapsed;

  if (shouldCollapse) {
    appSidebar.classList.add('collapsed');
    sidebarBackdrop.classList.add('hidden');
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, 'true');
  } else {
    appSidebar.classList.remove('collapsed');
    if (window.innerWidth <= 960) {
      sidebarBackdrop.classList.remove('hidden');
    }
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, 'false');
  }
}

function openNotebookModal() {
  notebookNameInput.value = '';
  newNotebookModal.classList.remove('hidden');
  setTimeout(() => notebookNameInput.focus(), 50);
}

function closeNotebookModal() {
  newNotebookModal.classList.add('hidden');
}

function switchTab(clickedBtn) {
  const targetId = clickedBtn.getAttribute('data-tab');

  tabBtns.forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });

  tabPanes.forEach(pane => {
    pane.classList.remove('active');
  });

  clickedBtn.classList.add('active');
  clickedBtn.setAttribute('aria-selected', 'true');

  const targetPane = document.getElementById(targetId);
  if (targetPane) {
    targetPane.classList.add('active');
  }
}

async function copySummaryToClipboard() {
  const summaryText = summaryTextOutput.textContent;
  if (!summaryText) {
    alert('No summary available to copy.');
    return;
  }

  try {
    await navigator.clipboard.writeText(summaryText);
    copyBtnText.textContent = 'Copied! ✓';
    copySummaryBtn.classList.add('btn-primary');
    copySummaryBtn.classList.remove('btn-secondary');

    setTimeout(() => {
      copyBtnText.textContent = 'Copy';
      copySummaryBtn.classList.remove('btn-primary');
      copySummaryBtn.classList.add('btn-secondary');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy text:', err);
    alert('Failed to copy to clipboard.');
  }
}

function exportCurrentNoteAsMarkdown() {
  if (!state.activeNote) return;

  const title = state.activeNote.title || 'Lecture Note';
  const summary = summaryTextOutput.textContent;
  const content = notesInput.value;
  const date = new Date().toLocaleDateString();

  let md = `# ${title}\nCourse: ${notebookSelect.options[notebookSelect.selectedIndex]?.text || 'General'}\nDate: ${date}\n\n`;
  
  if (summary) {
    md += `## 📄 Executive AI Summary\n${summary}\n\n`;
  }

  if (state.activeNote.bullets && state.activeNote.bullets.length > 0) {
    md += `## 📌 Key Core Takeaways\n`;
    state.activeNote.bullets.forEach((b, i) => {
      md += `${i + 1}. ${b}\n`;
    });
    md += `\n`;
  }

  if (state.activeNote.flashcards && state.activeNote.flashcards.length > 0) {
    md += `## 🗂️ Active Recall Flashcards\n`;
    state.activeNote.flashcards.forEach(c => {
      md += `### Card ${c.id}: ${c.question}\n**Answer:** ${c.answer}\n\n`;
    });
  }

  md += `## 📝 Full Raw Lecture Notes\n${content}\n`;

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const defaultTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

  setTheme(defaultTheme);

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Recently';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// 12. CLIENT-SIDE PDF & DOCUMENT PARSER (PDF.js Integration)
// ============================================================================

/**
 * Initializes the PDF.js web worker source
 */
function initPdfLib() {
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

/**
 * Extracts text from PDF, TXT, or Markdown documents 100% locally in browser
 */
async function handleDocumentFile(file) {
  if (!file) return;

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isText = file.type.startsWith('text/') || file.name.match(/\.(txt|md|markdown)$/i);

  if (!isPdf && !isText) {
    alert('Please upload a PDF document (.pdf) or text note file (.txt, .md).');
    return;
  }

  try {
    let extractedText = '';

    if (isPdf) {
      if (!window.pdfjsLib) {
        alert('PDF.js library is not available. Please verify your internet connection.');
        return;
      }

      pdfParseProgressBanner.classList.remove('hidden');
      pdfParseStatusText.textContent = 'Reading PDF binary data...';

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;

      let pageTexts = [];
      for (let i = 1; i <= numPages; i++) {
        pdfParseStatusText.textContent = `Extracting text from PDF (Page ${i} of ${numPages})...`;
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const strings = textContent.items.map(item => item.str);
        const cleanPageText = strings.join(' ').replace(/\s+/g, ' ').trim();
        if (cleanPageText) {
          pageTexts.push(`[Slide / Page ${i}]\n${cleanPageText}`);
        }
      }

      extractedText = pageTexts.join('\n\n');
    } else {
      extractedText = await file.text();
    }

    pdfParseProgressBanner.classList.add('hidden');

    if (!extractedText.trim()) {
      alert('No readable text could be extracted from this document (it might be a scanned image-only PDF without OCR).');
      return;
    }

    // Auto-populate note title from file name if currently untitled
    const rawName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const formattedTitle = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    if (!noteTitleInput.value.trim() || noteTitleInput.value.trim() === 'Untitled Lecture Note') {
      noteTitleInput.value = formattedTitle;
    }

    // Load extracted text into active note
    notesInput.value = extractedText;
    handleNoteInput();
    notesInput.scrollTop = 0;

    console.log(`[StudyBrain AI] Successfully extracted ${calculateWordCount(extractedText)} words from ${file.name}.`);
  } catch (err) {
    console.error('PDF extraction failed:', err);
    pdfParseProgressBanner.classList.add('hidden');
    alert('Error extracting text from document: ' + err.message);
  }
}

// ============================================================================
// 13. EVENT LISTENERS INITIALIZATION
// ============================================================================
function initEventListeners() {
  // Document / PDF Upload button & file input
  uploadPdfBtn.addEventListener('click', () => pdfFileInput.click());
  pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleDocumentFile(e.target.files[0]);
    }
    e.target.value = ''; // Reset input to allow re-uploading same file
  });

  // Drag and Drop over Textarea Container
  let dragCounter = 0;

  textareaContainer.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropZoneOverlay.classList.remove('hidden');
  });

  textareaContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  textareaContainer.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropZoneOverlay.classList.add('hidden');
    }
  });

  textareaContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropZoneOverlay.classList.add('hidden');

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleDocumentFile(e.dataTransfer.files[0]);
    }
  });
  // Sidebar Toggle
  sidebarToggleBtn.addEventListener('click', () => toggleSidebar());
  sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

  // Keyboard shortcut Ctrl+B / Cmd+B for Sidebar
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Notebook Dropdown Switcher
  notebookSelect.addEventListener('change', async (e) => {
    await flushActiveNoteSave();
    state.activeNotebookId = e.target.value;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTEBOOK, state.activeNotebookId);
    
    const activeNb = state.notebooks.find(nb => nb.id === state.activeNotebookId);
    if (activeNb) activeNotebookDot.style.backgroundColor = activeNb.color || '#6366f1';
    
    await reloadNotesForActiveNotebook();
  });

  // Notebook Management Modals
  addNotebookBtn.addEventListener('click', openNotebookModal);
  closeModalBtn.addEventListener('click', closeNotebookModal);
  cancelModalBtn.addEventListener('click', closeNotebookModal);
  saveNotebookBtn.addEventListener('click', handleCreateNotebook);
  deleteNotebookBtn.addEventListener('click', handleDeleteActiveNotebook);

  // Color Swatch Selector in Modal
  colorPalette.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      colorPalette.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      state.selectedModalColor = dot.getAttribute('data-color');
    });
  });

  // Notes Search
  searchNotesInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearSearchBtn.classList.toggle('hidden', state.searchQuery === '');
    reloadNotesForActiveNotebook();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchNotesInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    reloadNotesForActiveNotebook();
  });

  // New Note
  newNoteBtn.addEventListener('click', createNewNote);

  // Note Title & Content Input
  noteTitleInput.addEventListener('input', handleNoteInput);
  notesInput.addEventListener('input', handleNoteInput);

  // Clear Note Action
  clearNotesBtn.addEventListener('click', async () => {
    if (!state.activeNote || notesInput.value.trim() === '') return;
    if (confirm('Clear the contents of this note?')) {
      notesInput.value = '';
      updateLiveCounters();
      state.activeNote.content = '';
      state.activeNote.summary = '';
      state.activeNote.bullets = [];
      state.activeNote.flashcards = [];
      await flushActiveNoteSave();
      selectNote(state.activeNote.id);
    }
  });

  // Load Sample Lecture
  loadSampleBtn.addEventListener('click', async () => {
    if (!state.activeNote) return;
    noteTitleInput.value = 'CS301: Deep Learning & Neural Architectures';
    notesInput.value = 
`Course: CS301 - Deep Learning & Neural Architectures
Topic: Foundations of Artificial Neural Networks and Gradient Descent

Artificial Neural Networks (ANNs) are computational models inspired by biological neural networks in the human brain. Biological neurons consist of dendrites that receive signals, a soma that computes input potentials, and an axon that propagates action potentials via synapses. In artificial counterparts, inputs are multiplied by adaptive scalar weights, aggregated through a summation junction along with a bias term, and passed through a non-linear activation function.

Non-linear activation functions such as ReLU (Rectified Linear Unit), Sigmoid, and GELU are crucial because they empower the network to approximate complex non-linear functions; without them, cascading multiple layers would simply collapse into a single linear transformation regardless of depth.

During supervised training, the network measures prediction errors via a loss function (such as Mean Squared Error for regression or Cross-Entropy for multi-class classification). The optimization process uses the Backpropagation algorithm, which computes the partial derivatives of the loss with respect to every weight using the calculus chain rule. These gradients dictate how weights are iteratively updated via Stochastic Gradient Descent (SGD) or the Adam optimizer to minimize overall loss.

Modern advancements have enabled edge AI, allowing neural models to execute directly within client devices and web browsers using WebAssembly (WASM) and WebGPU. Running models locally preserves user data privacy, eliminates server operational costs, and facilitates instant inference without continuous network latency.`;
    handleNoteInput();
  });

  // Summarize Action
  summarizeBtn.addEventListener('click', triggerSummarization);

  // Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn));
  });

  // Action Buttons
  copySummaryBtn.addEventListener('click', copySummaryToClipboard);
  downloadNotesBtn.addEventListener('click', exportCurrentNoteAsMarkdown);
  flipAllCardsBtn.addEventListener('click', toggleFlipAllCards);

  // Workspace Backup & Restore
  exportWorkspaceBtn.addEventListener('click', exportWorkspaceBackup);
  importWorkspaceBtn.addEventListener('click', () => restoreFileInput.click());
  restoreFileInput.addEventListener('change', handleRestoreFile);
}

// ============================================================================
// 13. BOOTSTRAP
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initPdfLib();
  initEventListeners();
  initializeWorker();

  // Restore saved sidebar preference
  const isSidebarCollapsed = localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true';
  if (isSidebarCollapsed) {
    toggleSidebar(true);
  }

  // Initialize IndexedDB database & load workspace
  try {
    await initializeDataLayer();
    console.log('[StudyBrain AI] IndexedDB Multi-Course Workspace initialized successfully.');
  } catch (err) {
    console.error('[StudyBrain AI] Failed to initialize IndexedDB:', err);
  }
});
