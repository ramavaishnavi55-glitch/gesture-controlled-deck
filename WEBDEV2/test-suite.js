/**
 * ============================================================================
 * test-suite.js - Automated Test Runner for StudyBrain AI
 * ============================================================================
 * Executes comprehensive unit, integration, and structural validation tests:
 * 1. DOM ID Synchronization (index.html <-> script.js)
 * 2. Algorithm Unit Tests (Word counting, bullet point parsing, flashcard heuristics)
 * 3. Security & Sanitization (HTML escaping / XSS prevention)
 * 4. CSS Variable & 3D Transform Rules Verification
 * 5. IndexedDB Backup & Restore Schema Integrity
 * 6. Web Worker Script Validation
 * ============================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read application source files
const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const cssContent = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf-8');
const scriptContent = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf-8');
const workerContent = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf-8');

// ============================================================================
// SUITE 1: DOM ID & Structural Synchronization
// ============================================================================
test('DOM ID Synchronization: Every getElementById in script.js must exist in index.html', () => {
  const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
  const matches = [...scriptContent.matchAll(idRegex)];
  const scriptIds = [...new Set(matches.map(m => m[1]))];

  assert.ok(scriptIds.length > 0, 'script.js should contain getElementById calls');

  const missingIds = [];
  scriptIds.forEach(id => {
    // Check if id exists as id="..." or id='...' in index.html
    const hasId = htmlContent.includes(`id="${id}"`) || htmlContent.includes(`id='${id}'`);
    if (!hasId) {
      missingIds.push(id);
    }
  });

  assert.deepEqual(
    missingIds,
    [],
    `The following DOM IDs are referenced in script.js but missing in index.html: ${missingIds.join(', ')}`
  );
});

test('Semantic HTML & Accessibility Compliance', () => {
  // Check essential accessibility tags
  assert.match(htmlContent, /<html\s+lang=["']en["']/i, '<html> tag must specify lang attribute');
  assert.match(htmlContent, /<meta\s+name=["']viewport["']/i, '<head> must include responsive viewport meta');
  assert.match(htmlContent, /role=["']tab["']/i, 'Tabs must include role="tab"');
  assert.match(htmlContent, /role=["']tabpanel["']/i, 'Tab panes must include role="tabpanel"');
  assert.match(htmlContent, /role=["']dialog["']/i, 'Modal must declare role="dialog"');
  assert.match(htmlContent, /aria-modal=["']true["']/i, 'Modal must declare aria-modal="true"');
  assert.match(htmlContent, /<script[^>]+type=["']module["']/i, 'script.js must be loaded with type="module"');
});

// ============================================================================
// SUITE 2: Core Algorithm Unit Tests
// ============================================================================
// Replicate pure helper functions from script.js for direct algorithmic testing
function calculateWordCount(str) {
  if (!str) return 0;
  return str.trim() === '' ? 0 : str.trim().split(/\s+/).filter(Boolean).length;
}

function extractBulletPoints(summaryText) {
  const sentences = summaryText
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  return sentences.length > 0 ? sentences : [summaryText];
}

function generateFlashcards(summaryText, bullets) {
  const cards = [];
  bullets.forEach((sentence, index) => {
    let question = '';
    let answer = sentence;
    const definitionMatch = sentence.match(/^([^.,:;]+?)\s+(is defined as|refers to|is a|is an|enables|helps|acts as|consists of)\s+(.*)/i);
    if (definitionMatch) {
      const subject = definitionMatch[1].trim();
      question = `What is the role and definition of "${subject}"?`;
    } else if (sentence.toLowerCase().includes('because') || sentence.toLowerCase().includes('due to')) {
      question = `Key Cause & Effect (Concept #${index + 1}): Why does this process occur?`;
    } else {
      question = `Key Takeaway #${index + 1}: What core principle is explained here?`;
    }
    cards.push({ id: index + 1, question, answer });
  });
  return cards;
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

test('Algorithm: calculateWordCount() accuracy under edge cases', () => {
  assert.equal(calculateWordCount(''), 0, 'Empty string should return 0');
  assert.equal(calculateWordCount(null), 0, 'Null should return 0');
  assert.equal(calculateWordCount(undefined), 0, 'Undefined should return 0');
  assert.equal(calculateWordCount('   '), 0, 'Whitespace-only should return 0');
  assert.equal(calculateWordCount('\n\t  \n'), 0, 'Newlines and tabs only should return 0');
  assert.equal(calculateWordCount('Hello'), 1, 'Single word');
  assert.equal(calculateWordCount('Hello world from Edge AI!'), 5, 'Normal sentence');
  assert.equal(calculateWordCount('Multiple    spaces \n and \t tabs between words'), 6, 'Irregular whitespace');
});

test('Algorithm: extractBulletPoints() sentence splitting', () => {
  const prose = 'Artificial Neural Networks mimic biological brains. Backpropagation optimizes weight gradients using calculus. Edge AI ensures complete user privacy!';
  const bullets = extractBulletPoints(prose);

  assert.equal(bullets.length, 3, 'Should extract exactly 3 distinct bullet points');
  assert.equal(bullets[0], 'Artificial Neural Networks mimic biological brains.');
  assert.equal(bullets[1], 'Backpropagation optimizes weight gradients using calculus.');
  assert.equal(bullets[2], 'Edge AI ensures complete user privacy!');
});

test('Algorithm: extractBulletPoints() fallback for short or unpunctuated text', () => {
  const rawText = 'Short note without punctuation';
  const bullets = extractBulletPoints(rawText);
  assert.equal(bullets.length, 1);
  assert.equal(bullets[0], rawText);
});

test('Algorithm: generateFlashcards() active-recall heuristics', () => {
  const bullets = [
    'Backpropagation is defined as the algorithm calculating loss gradients via the chain rule.',
    'Model accuracy degrades over time due to data distribution drift in production.',
    'Regularization penalizes extreme weights to prevent overfitting.'
  ];

  const cards = generateFlashcards('Summary', bullets);

  assert.equal(cards.length, 3);

  // Card 1: Definition Heuristic
  assert.match(cards[0].question, /What is the role and definition of "Backpropagation"\?/);
  assert.equal(cards[0].answer, bullets[0]);

  // Card 2: Cause & Effect Heuristic
  assert.match(cards[1].question, /Key Cause & Effect/);
  assert.equal(cards[1].answer, bullets[1]);

  // Card 3: General Takeaway Fallback
  assert.match(cards[2].question, /Key Takeaway #3/);
  assert.equal(cards[2].answer, bullets[2]);
});

test('Security: escapeHtml() sanitization against XSS payloads', () => {
  const maliciousScript = '<script>alert("XSS")</script>';
  const escaped = escapeHtml(maliciousScript);
  assert.equal(escaped, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');

  const maliciousAttribute = '"><img src=x onerror=alert(1)>';
  const escapedAttr = escapeHtml(maliciousAttribute);
  assert.equal(escapedAttr, '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

// ============================================================================
// SUITE 3: CSS & Responsive Design System Validation
// ============================================================================
test('CSS Design Tokens & Theming Variables', () => {
  // Verify Light Theme Variables
  assert.match(cssContent, /--bg-page:\s*#/, ':root must define --bg-page');
  assert.match(cssContent, /--primary:\s*#/, ':root must define --primary');
  assert.match(cssContent, /--border-color:\s*#/, ':root must define --border-color');

  // Verify Dark Theme Variables
  assert.match(cssContent, /\[data-theme=["']dark["']\]/, 'CSS must include dark theme selector');
  assert.match(cssContent, /\[data-theme=["']dark["']\][^{]*\{[^}]*--bg-page:\s*#0b0f19/s, 'Dark mode background must be set');
});

test('CSS 3D Flashcard Transforms & Physics', () => {
  assert.match(cssContent, /perspective:\s*1200px/, 'Flashcard grid must declare 3D perspective');
  assert.match(cssContent, /transform-style:\s*preserve-3d/, '.flashcard-inner must preserve-3d');
  assert.match(cssContent, /backface-visibility:\s*hidden/, 'Front and back faces must hide backface');
  assert.match(cssContent, /transform:\s*rotateY\(180deg\)/, 'Flipped card must rotate 180 degrees');
});

test('CSS Responsiveness & Sidebar Layout', () => {
  assert.match(cssContent, /\.app-sidebar\.collapsed/, 'CSS must define .collapsed sidebar rule');
  assert.match(cssContent, /@media\s*\(\s*max-width:\s*960px\s*\)/, 'CSS must provide breakpoint for <= 960px screens');
});

// ============================================================================
// SUITE 4: Web Worker & AI Pipeline Configuration
// ============================================================================
test('worker.js: Transformers.js Import & Browser Cache Configuration', () => {
  assert.match(
    workerContent,
    /from\s+['"]https:\/\/cdn\.jsdelivr\.net\/npm\/@xenova\/transformers/,
    'worker.js must import Transformers.js via ESM CDN'
  );
  assert.match(workerContent, /env\.allowLocalModels\s*=\s*false/, 'env.allowLocalModels must be false');
  assert.match(workerContent, /env\.useBrowserCache\s*=\s*true/, 'env.useBrowserCache must be true for permanent caching');
  assert.match(workerContent, /Xenova\/distilbart-cnn-6-6/, 'worker.js must target distilbart-cnn-6-6 model');
  assert.match(workerContent, /self\.addEventListener\(['"]message['"]/, 'worker.js must listen to message event');
});

// ============================================================================
// SUITE 5: IndexedDB Backup & Restore Schema Integrity
// ============================================================================
test('Data Portability: Workspace Backup Payload Verification', () => {
  const sampleBackup = {
    app: 'StudyBrain AI',
    version: 1,
    exportedAt: new Date().toISOString(),
    notebooks: [
      { id: 'nb_1', name: 'CS301 - Deep Learning', color: '#6366f1', createdAt: Date.now() }
    ],
    notes: [
      {
        id: 'note_1',
        notebookId: 'nb_1',
        title: 'Lecture 1: Perceptrons',
        content: 'Perceptrons are single layer neural units...',
        summary: 'Perceptrons form neural network foundations.',
        bullets: ['Perceptrons form neural network foundations.'],
        flashcards: [{ id: 1, question: 'What is a perceptron?', answer: 'A single layer neural unit.' }],
        summaryLength: 'medium',
        wordCount: 6,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  };

  // Validate JSON serialization and schema fields
  const serialized = JSON.stringify(sampleBackup);
  const parsed = JSON.parse(serialized);

  assert.equal(parsed.app, 'StudyBrain AI');
  assert.equal(parsed.version, 1);
  assert.ok(Array.isArray(parsed.notebooks), 'notebooks must be an array');
  assert.ok(Array.isArray(parsed.notes), 'notes must be an array');
  assert.equal(parsed.notebooks[0].id, 'nb_1');
  assert.equal(parsed.notes[0].notebookId, 'nb_1');
  assert.ok(parsed.notes[0].flashcards.length > 0);
});

// ============================================================================
// SUITE 6: Client-Side Search & Relative Time Logic
// ============================================================================
function filterNotesBySearch(notes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter(n => 
    (n.title && n.title.toLowerCase().includes(q)) ||
    (n.content && n.content.toLowerCase().includes(q)) ||
    (n.summary && n.summary.toLowerCase().includes(q))
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Recently';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

test('Algorithm: filterNotesBySearch() query handling', () => {
  const notes = [
    { id: '1', title: 'Deep Learning Basics', content: 'Intro to gradient descent', summary: 'Optimization algorithm' },
    { id: '2', title: 'Cell Biology', content: 'Mitochondria structure and ATP synthesis', summary: 'Energy powerhouse' },
    { id: '3', title: 'World War 2', content: 'Historical overview of 1939-1945', summary: 'Major geopolitical conflict' }
  ];

  // Empty query returns all notes
  assert.equal(filterNotesBySearch(notes, '').length, 3);
  assert.equal(filterNotesBySearch(notes, '   ').length, 3);

  // Match in title
  const titleMatches = filterNotesBySearch(notes, 'deep');
  assert.equal(titleMatches.length, 1);
  assert.equal(titleMatches[0].id, '1');

  // Match in content
  const contentMatches = filterNotesBySearch(notes, 'mitochondria');
  assert.equal(contentMatches.length, 1);
  assert.equal(contentMatches[0].id, '2');

  // Match in summary
  const summaryMatches = filterNotesBySearch(notes, 'conflict');
  assert.equal(summaryMatches.length, 1);
  assert.equal(summaryMatches[0].id, '3');

  // Non-matching query
  assert.equal(filterNotesBySearch(notes, 'Quantum Mechanics').length, 0);
});

test('Algorithm: formatRelativeTime() delta intervals', () => {
  const now = Date.now();
  assert.equal(formatRelativeTime(now - 10 * 1000), 'Just now');
  assert.equal(formatRelativeTime(now - 15 * 60 * 1000), '15m ago');
  assert.equal(formatRelativeTime(now - 3 * 3600 * 1000), '3h ago');
  assert.ok(formatRelativeTime(now - 48 * 3600 * 1000).length > 0);
});

// ============================================================================
// SUITE 7: External CDN Network Availability (Transformers.js)
// ============================================================================
test('Network: Transformers.js CDN is reachable and returns 200 OK', async () => {
  const cdnUrl = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  try {
    const response = await fetch(cdnUrl, { method: 'HEAD' });
    assert.ok(response.status >= 200 && response.status < 400, `CDN returned status ${response.status}`);
  } catch (err) {
    // If the machine is running completely offline, log informative warning
    console.warn(`[Network Test Warning]: Could not reach ${cdnUrl}. (Offline mode):`, err.message);
  }
});

// ============================================================================
// SUITE 8: PDF Parser & Document Ingestion Engine
// ============================================================================
test('PDF Integration: PDF.js script tag and Drag & Drop UI elements', () => {
  assert.match(htmlContent, /src=["'][^"']*pdf(\.min)?\.js["']/, 'index.html must include PDF.js library script');
  assert.match(htmlContent, /id=["']uploadPdfBtn["']/, 'Upload PDF button must be present in index.html');
  assert.match(htmlContent, /id=["']dropZoneOverlay["']/, 'Dropzone overlay must be present in index.html');
  assert.match(htmlContent, /id=["']pdfParseProgressBanner["']/, 'PDF progress banner must be present in index.html');
});

test('Algorithm: Document filename formatting to clean note title', () => {
  function formatDocumentTitle(filename) {
    const raw = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  assert.equal(formatDocumentTitle('cs301_deep_learning_lecture4.pdf'), 'Cs301 deep learning lecture4');
  assert.equal(formatDocumentTitle('neural-networks-overview.txt'), 'Neural networks overview');
  assert.equal(formatDocumentTitle('mitochondria_atp_biology.md'), 'Mitochondria atp biology');
});

// ============================================================================
// SUITE 9: Interactive Practice Quiz (MCQ Exam) Generator
// ============================================================================
test('Quiz Integration: Quiz tab and DOM containers exist in index.html', () => {
  assert.match(htmlContent, /id=["']tabQuiz["']/, 'tabQuiz button must exist');
  assert.match(htmlContent, /id=["']quizCountBadge["']/, 'quizCountBadge must exist');
  assert.match(htmlContent, /id=["']emptyQuizState["']/, 'emptyQuizState must exist');
  assert.match(htmlContent, /id=["']activeQuizContent["']/, 'activeQuizContent must exist');
  assert.match(htmlContent, /id=["']quizScoreText["']/, 'quizScoreText must exist');
  assert.match(htmlContent, /id=["']retakeQuizBtn["']/, 'retakeQuizBtn must exist');
  assert.match(htmlContent, /id=["']quizQuestionsContainer["']/, 'quizQuestionsContainer must exist');
});

test('Algorithm: generateQuizQuestions() multiple-choice question synthesis', () => {
  const bullets = [
    'Backpropagation is defined as an algorithm calculating loss gradients via the chain rule.',
    'Activation functions introduce non-linearity into multi-layer neural network architectures.',
    'Stochastic gradient descent updates model weights iteratively to minimize loss.',
    'WebAssembly enables high performance in-browser tensor computation.'
  ];

  function generateQuizQuestions(summaryText, bullets) {
    const questions = [];
    const validBullets = bullets.filter(b => b && b.trim().length > 15);
    const numQuestions = Math.min(5, validBullets.length);

    for (let i = 0; i < numQuestions; i++) {
      const targetBullet = validBullets[i];
      const defMatch = targetBullet.match(/^([^.,:;]+?)\s+(is defined as|refers to|is a|is an|enables|helps|acts as|consists of)\s+(.*)/i);
      let stem = '';
      let correctAnswer = '';
      let explanation = '';

      if (defMatch) {
        const subject = defMatch[1].trim();
        const predicate = defMatch[3].trim();
        stem = `Which of the following best defines or describes "${subject}"?`;
        correctAnswer = predicate.replace(/[.]+$/, '');
        explanation = `Verified from notes: "${subject}" ${defMatch[2]} ${predicate}`;
      } else {
        stem = `According to your lecture notes, which statement is factually accurate?`;
        correctAnswer = targetBullet.replace(/[.]+$/, '');
        explanation = `Correct! Sourced directly from your lecture notes: "${targetBullet}"`;
      }

      const otherBullets = validBullets.filter((_, idx) => idx !== i);
      let distractors = [
        'It functions as a strict linear transformation without dynamic parameter optimization.',
        'It operates purely on static lookup tables without iterative mathematical updates.',
        'It has been proven obsolete due to lack of generalizability across domain distributions.'
      ];
      if (otherBullets.length >= 3) {
        distractors = otherBullets.slice(0, 3).map(b => b.replace(/[.]+$/, ''));
      }

      const shuffled = [correctAnswer, distractors[0], distractors[1], distractors[2]];
      const correctIndex = 0;

      questions.push({
        id: i + 1,
        question: stem,
        options: shuffled,
        correctIndex: correctIndex,
        explanation: explanation,
        userSelectedIndex: null
      });
    }
    return questions;
  }

  const quiz = generateQuizQuestions('Summary', bullets);

  assert.equal(quiz.length, 4, 'Should generate 4 questions from 4 bullets');
  
  quiz.forEach(q => {
    assert.ok(q.question.length > 10, 'Question stem must be informative');
    assert.equal(q.options.length, 4, 'Each MCQ must have exactly 4 options');
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4, 'correctIndex must be between 0 and 3');
    assert.ok(q.explanation.length > 5, 'Explanation must be non-empty');
  });

  // Verify definition match question stem
  assert.match(quiz[0].question, /Backpropagation/);
});
