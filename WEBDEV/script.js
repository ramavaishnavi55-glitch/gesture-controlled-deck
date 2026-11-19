/**
 * script.js — Gesture-Controlled Presentation Deck
 * =============================================================
 * HOW THIS FILE IS ORGANIZED:
 *   1. Imports & Constants
 *   2. DOM References
 *   3. State Variables
 *   4. Slide Navigation Logic
 *   5. Video Playback Logic
 *   6. Webcam Setup
 *   7. MediaPipe Hand Landmarker Setup
 *   8. Per-Frame Detection Loop
 *   9. Gesture Recognition Functions
 *  10. Canvas Drawing (hand skeleton overlay)
 *  11. Event Listeners (button clicks)
 *
 * BEGINNER TIP:
 *   Read through the comments top-to-bottom once before changing anything.
 *   Every non-obvious line is explained right next to it.
 * =============================================================
 */

// ─── 1. IMPORTS & CONSTANTS ───────────────────────────────────
/*
  We use the MediaPipe Tasks Vision package directly from jsDelivr CDN.
  'type="module"' on the <script> tag in index.html lets us use
  ES Module import syntax here — no bundler needed.
*/
import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

/** Landmark indices from the MediaPipe hand model — memorize these! */
const LM = {
  WRIST:         0,
  THUMB_TIP:     4,
  INDEX_MCP:     5,   // MCP = knuckle at the base of the finger
  INDEX_TIP:     8,
  MIDDLE_MCP:    9,
  MIDDLE_TIP:   12,
  RING_MCP:     13,
  RING_TIP:     16,
  PINKY_MCP:    17,
  PINKY_TIP:    20,
};

/** How long (ms) to ignore new gestures after one fires. */
const COOLDOWN_MS = 1500;

/** Minimum horizontal distance (in normalized coords 0–1) for a "pointing" gesture. */
const POINT_THRESHOLD = 0.08;


// ─── 2. DOM REFERENCES ────────────────────────────────────────
const slides         = document.querySelectorAll('.slide');
const currentSlideEl = document.getElementById('current-slide');
const btnPrev        = document.getElementById('btn-prev');
const btnNext        = document.getElementById('btn-next');
const btnPlayPause   = document.getElementById('btn-playpause');
const btnCamera      = document.getElementById('btn-camera');
const demoVideo      = document.getElementById('demo-video');
const videoOverlay   = document.getElementById('video-overlay-icon');
const webcamEl       = document.getElementById('webcam');
const canvasEl       = document.getElementById('landmark-canvas');
const camPreview     = document.getElementById('cam-preview');
const gestureBadge   = document.getElementById('gesture-badge');
const gestureLabel   = document.getElementById('gesture-label');
const gestureIcon    = document.getElementById('gesture-icon');

/** 2D drawing context for the landmark canvas */
const ctx = canvasEl.getContext('2d');

// Loading screen elements
const loadingScreen  = document.getElementById('loading-screen');
const progressFill   = document.getElementById('progress-fill');
const progressPct    = document.getElementById('progress-percent');
const loadingStatus  = document.getElementById('loading-status');


// ─── 3. STATE VARIABLES ───────────────────────────────────────
let currentSlideIndex = 0;      // which slide is showing (0-based)
let handLandmarker    = null;    // will hold the loaded MediaPipe model
let isCameraRunning   = false;   // is the webcam active?
let lastGestureTime   = 0;       // timestamp of the last fired gesture (for cooldown)
let animFrameId       = null;    // requestAnimationFrame handle (lets us cancel the loop)


// ─── LOADING SCREEN HELPERS ───────────────────────────────────
/**
 * setProgress(percent, statusText)
 * Updates the loading bar fill width, the percentage label,
 * and the status description line.
 *
 * @param {number} percent    - 0 to 100
 * @param {string} statusText - Short description of the current step
 */
function setProgress(percent, statusText) {
  progressFill.style.width   = percent + '%';
  progressPct.textContent    = percent + '%';
  loadingStatus.textContent  = statusText;
}

/**
 * hideLoadingScreen()
 * Adds the .done class which triggers the CSS fade-out transition.
 * Called once the AI model is loaded and everything is ready.
 */
function hideLoadingScreen() {
  loadingScreen.classList.add('done');
}


// ─── 4. SLIDE NAVIGATION ──────────────────────────────────────
/**
 * goToSlide(index)
 * Removes the 'active' class from the current slide and
 * adds it to the target slide. The CSS transition handles the animation.
 *
 * @param {number} index - 0-based slide index to show
 */
function goToSlide(index) {
  // Clamp the index so we don't go below 0 or above the last slide
  const newIndex = Math.max(0, Math.min(index, slides.length - 1));

  if (newIndex === currentSlideIndex) return; // already on this slide

  /*
    FIX #1 (stale closure): capture the exiting slide element in a local
    const RIGHT NOW, before the setTimeout fires. If we referenced
    slides[currentSlideIndex] inside the callback, currentSlideIndex
    would already equal newIndex by then — wrong slide gets cleaned up.

    FIX #5 (double-assignment): only assign currentSlideIndex ONCE,
    inside the timeout after cleanup. The old code set it both inline
    AND inside the timeout, so a rapid second call could read a stale
    value mid-transition.
  */
  const exitingSlide = slides[currentSlideIndex]; // snapshot before async gap

  exitingSlide.classList.remove('active');
  exitingSlide.classList.add('exiting');

  // After the CSS transition ends, clean up the 'exiting' class
  setTimeout(() => {
    exitingSlide.classList.remove('exiting'); // uses captured ref — always correct
    currentSlideIndex = newIndex;             // single assignment, happens once
  }, 650); // must match --transition-speed in CSS (0.6s + a little buffer)

  // Show the new slide immediately (opacity transition handles the animation)
  slides[newIndex].classList.add('active');

  // Update the "Slide X of 4" counter
  currentSlideEl.textContent = newIndex + 1;
}

function nextSlide() { goToSlide(currentSlideIndex + 1); }
function prevSlide() { goToSlide(currentSlideIndex - 1); }


// ─── 5. VIDEO PLAYBACK ────────────────────────────────────────
/**
 * toggleVideo()
 * Plays the video if paused, pauses it if playing.
 * Also updates the button label and overlay icon.
 */
function toggleVideo() {
  if (demoVideo.paused) {
    /*
      FIX #6: play() returns a Promise. On browsers that block autoplay
      (or if the video src hasn't loaded yet) it rejects, which causes an
      "Uncaught (in promise) DOMException" in the console. We catch it and
      restore the button state so the UI doesn't get out of sync.
    */
    demoVideo.play().catch((err) => {
      console.warn('Video play() was blocked:', err);
      btnPlayPause.textContent = '▶ Play';
      videoOverlay.classList.remove('hidden');
    });
    btnPlayPause.textContent = '⏸ Pause';
    videoOverlay.classList.add('hidden');
  } else {
    demoVideo.pause();
    btnPlayPause.textContent = '▶ Play';
    videoOverlay.classList.remove('hidden');
    videoOverlay.textContent = '⏸';
  }
}

// Keep the overlay icon in sync when the video ends naturally
demoVideo.addEventListener('pause', () => {
  videoOverlay.classList.remove('hidden');
  videoOverlay.textContent = '▶';
  btnPlayPause.textContent = '▶ Play';
});

demoVideo.addEventListener('play', () => {
  videoOverlay.classList.add('hidden');
  btnPlayPause.textContent = '⏸ Pause';
});


// ─── 6. WEBCAM SETUP ──────────────────────────────────────────
/**
 * startCamera()
 * Requests webcam access from the browser.
 * On success, starts the MediaPipe detection loop.
 * On failure, shows a user-friendly error.
 */
async function startCamera() {
  if (isCameraRunning) {
    stopCamera();
    return;
  }

  try {
    // Ask the browser for a 640×480 video stream from the user's camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });

    webcamEl.srcObject = stream;

    // Wait for the video metadata (dimensions) to load before we start
    webcamEl.addEventListener('loadedmetadata', async () => {
      // Size the canvas to match the actual video dimensions
      canvasEl.width  = webcamEl.videoWidth;
      canvasEl.height = webcamEl.videoHeight;

      isCameraRunning = true;
      camPreview.classList.remove('hidden');
      btnCamera.textContent = '🔴 Stop Camera';
      btnCamera.classList.add('recording');

      // Model is already loaded by the page-start init — just start the loop
      setGestureLabel('✋', 'Camera ready!');
      runDetectionLoop();
    }, { once: true });

  } catch (error) {
    console.error('Camera access denied or not available:', error);
    setGestureLabel('❌', 'Camera error');
    alert(
      'Could not access the camera.\n\n' +
      'Make sure you granted camera permissions and that no other app is using it.'
    );
  }
}

/**
 * stopCamera()
 * Stops the webcam stream and cancels the detection loop.
 */
function stopCamera() {
  if (!isCameraRunning) return;

  // Stop all video tracks (releases the camera hardware)
  const stream = webcamEl.srcObject;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  webcamEl.srcObject = null;
  isCameraRunning = false;

  // Cancel the pending animation frame so the loop stops
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Clear the landmark canvas
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  camPreview.classList.add('hidden');
  btnCamera.textContent = '📷 Start Camera';
  btnCamera.classList.remove('recording');
  setGestureLabel('✋', 'No Gesture');
}


// ─── 7. MEDIAPIPE HAND LANDMARKER SETUP ───────────────────────
/**
 * initHandLandmarker()
 * Downloads the MediaPipe model files from the CDN and creates
 * the HandLandmarker instance with our desired settings.
 *
 * Also drives the loading screen progress bar through 4 real steps
 * so the user always knows what is happening.
 */
async function initHandLandmarker() {
  try {
    // ── Step 1: Page assets loaded (we're already here) ──────
    setProgress(10, 'Page loaded. Preparing AI runtime…');
    await pause(300); // small visual pause so the user sees step 1

    // ── Step 2: Download the WebAssembly runtime ──────────────
    setProgress(30, 'Downloading WebAssembly runtime…');

    /*
      FilesetResolver locates the WebAssembly (.wasm) runtime files
      that MediaPipe needs to run the AI model in the browser.
    */
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // ── Step 3: Download and compile the hand model ───────────
    setProgress(60, 'Downloading hand landmark model (~10 MB)…');

    /*
      HandLandmarker.createFromOptions() downloads the actual AI model
      file. This is the step that takes the longest on a slow connection.
    */
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",  // prefers GPU; falls back to CPU automatically
      },
      runningMode: "VIDEO",
      numHands: 1,
    });

    // ── Step 4: All done ──────────────────────────────────────
    setProgress(100, 'Ready! Click "Start Camera" to begin.');
    await pause(600); // let the user read "Ready!" for a moment

    console.log("✅ HandLandmarker model loaded successfully.");

    // Fade out the loading screen
    hideLoadingScreen();

  } catch (err) {
    // If anything fails (no internet, CDN down, etc.) tell the user clearly
    setProgress(0, '❌ Failed to load AI model. Check your internet connection.');
    console.error('MediaPipe init failed:', err);
  }
}

/**
 * pause(ms)
 * Simple Promise-based delay. Used to hold a loading step on screen
 * long enough for the user to read it.
 *
 * @param {number} ms - milliseconds to wait
 * @returns {Promise}
 */
function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ─── 8. PER-FRAME DETECTION LOOP ──────────────────────────────
/**
 * runDetectionLoop()
 * Called once to kick off the loop.
 * Uses requestAnimationFrame so it syncs with the browser's render cycle
 * (~60 times per second) rather than running a blocking while(true).
 *
 * Each call:
 *   1. Sends the current video frame to MediaPipe
 *   2. Reads back the detected hand landmarks
 *   3. Draws the skeleton on the canvas
 *   4. Runs gesture recognition
 *   5. Schedules itself to run again next frame
 */
function runDetectionLoop() {
  if (!isCameraRunning || !handLandmarker) return;

  /*
    FIX #4: detectForVideo() throws a hard error if the video element has
    not decoded enough data yet (readyState < HAVE_ENOUGH_DATA = 4).
    This happens on the very first few frames right after srcObject is set.
    We skip those frames and try again next animation tick.
  */
  if (webcamEl.readyState < 4) {
    animFrameId = requestAnimationFrame(runDetectionLoop);
    return;
  }

  // performance.now() gives a high-resolution timestamp in milliseconds
  const timestampMs = performance.now();

  /*
    detectForVideo() takes a video element and a timestamp.
    The timestamp MUST increase each call — MediaPipe uses it to
    track motion across frames for the VIDEO running mode.
    It returns a results object with a 'landmarks' array.
  */
  const results = handLandmarker.detectForVideo(webcamEl, timestampMs);

  // Clear the previous frame's skeleton drawing
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const hand = results.landmarks[0]; // first (and only) detected hand

    // Draw the hand skeleton on the canvas overlay
    drawHandSkeleton(hand);

    // Try to recognize a gesture and act on it (with cooldown)
    recognizeAndAct(hand);
  } else {
    // No hand in frame — clear the status badge softly
    if (gestureBadge.classList.contains('active')) {
      gestureBadge.classList.remove('active');
      setGestureLabel('✋', 'No Gesture');
    }
  }

  // Schedule the next frame — this is what keeps the loop running
  animFrameId = requestAnimationFrame(runDetectionLoop);
}


// ─── 9. GESTURE RECOGNITION ───────────────────────────────────
/**
 * recognizeAndAct(landmarks)
 * Decides which gesture the user is making and fires the
 * corresponding action (next slide, prev slide, play/pause).
 *
 * Cooldown check: if fewer than COOLDOWN_MS milliseconds have passed
 * since the last action, we skip to avoid repeat triggers.
 *
 * @param {Array} landmarks - Array of 21 {x, y, z} objects from MediaPipe.
 *   Coordinates are NORMALIZED: x and y are in the range 0.0 → 1.0
 *   where (0,0) is the top-left of the video frame.
 */
function recognizeAndAct(landmarks) {
  const now = performance.now();
  if (now - lastGestureTime < COOLDOWN_MS) return; // still in cooldown

  // ── Check each gesture in order of specificity (most specific first) ──

  if (isOpenPalm(landmarks)) {
    lastGestureTime = now;
    setGestureLabel('🖐️', 'Open Palm → Play/Pause');
    gestureBadge.classList.add('active');
    toggleVideo();
    return;
  }

  if (isPointingRight(landmarks)) {
    lastGestureTime = now;
    setGestureLabel('👉', 'Point Right → Next Slide');
    gestureBadge.classList.add('active');
    nextSlide();
    return;
  }

  if (isPointingLeft(landmarks)) {
    lastGestureTime = now;
    setGestureLabel('👈', 'Point Left → Prev Slide');
    gestureBadge.classList.add('active');
    prevSlide();
    return;
  }

  // No recognized gesture — just update the label quietly
  gestureBadge.classList.remove('active');
  setGestureLabel('✋', 'Hand detected…');
}

/**
 * isFingerExtended(landmarks, tipIndex, mcpIndex)
 * Returns true if a finger is "pointing up" (extended).
 *
 * HOW: A finger is extended when its TIP is higher on the screen
 * than its MCP (knuckle). In MediaPipe's coordinate system,
 * Y=0 is the TOP of the frame, so a SMALLER Y means higher up.
 *
 * We use a small threshold (0.04) to avoid false positives from
 * slightly bent fingers.
 *
 * @param {Array}  landmarks - the 21-point landmark array
 * @param {number} tipIndex  - landmark index of the fingertip
 * @param {number} mcpIndex  - landmark index of the base knuckle
 * @returns {boolean}
 */
function isFingerExtended(landmarks, tipIndex, mcpIndex) {
  return landmarks[tipIndex].y < landmarks[mcpIndex].y - 0.04;
}

/**
 * isOpenPalm(landmarks)
 * Returns true when ALL four fingers AND the thumb are extended.
 * We check the thumb differently: its tip should be far to the
 * side of its base (along the X axis).
 *
 * @param {Array} landmarks
 * @returns {boolean}
 */
function isOpenPalm(landmarks) {
  const indexUp  = isFingerExtended(landmarks, LM.INDEX_TIP,  LM.INDEX_MCP);
  const middleUp = isFingerExtended(landmarks, LM.MIDDLE_TIP, LM.MIDDLE_MCP);
  const ringUp   = isFingerExtended(landmarks, LM.RING_TIP,   LM.RING_MCP);
  const pinkyUp  = isFingerExtended(landmarks, LM.PINKY_TIP,  LM.PINKY_MCP);

  /*
    For the thumb, check that the tip's X coordinate is sufficiently
    far from the index MCP. If |thumbTip.x - indexMCP.x| > 0.1,
    the thumb is spread out (open).
  */
  const thumbSpread =
    Math.abs(landmarks[LM.THUMB_TIP].x - landmarks[LM.INDEX_MCP].x) > 0.1;

  return indexUp && middleUp && ringUp && pinkyUp && thumbSpread;
}

/**
 * isPointingRight(landmarks)
 * Returns true when ONLY the index finger is extended AND
 * the fingertip's X position is significantly to the right of
 * the hand's wrist X position.
 *
 * NOTE: Remember the video is CSS-mirrored. What appears on the
 * right side of the preview corresponds to a LOWER X value in
 * MediaPipe's raw coordinates (which are un-flipped). So we check
 * tip.x < wrist.x (tip is to the LEFT in raw coords = RIGHT on screen).
 *
 * @param {Array} landmarks
 * @returns {boolean}
 */
function isPointingRight(landmarks) {
  const indexExtended  = isFingerExtended(landmarks, LM.INDEX_TIP,  LM.INDEX_MCP);
  const middleCurled   = !isFingerExtended(landmarks, LM.MIDDLE_TIP, LM.MIDDLE_MCP);
  const ringCurled     = !isFingerExtended(landmarks, LM.RING_TIP,   LM.RING_MCP);
  const pinkyCurled    = !isFingerExtended(landmarks, LM.PINKY_TIP,  LM.PINKY_MCP);

  // Index tip must be clearly to the LEFT of the wrist in raw coords
  // (= pointing RIGHT in the mirrored preview)
  const pointingHorizontally =
    landmarks[LM.INDEX_TIP].x < landmarks[LM.WRIST].x - POINT_THRESHOLD;

  return indexExtended && middleCurled && ringCurled && pinkyCurled && pointingHorizontally;
}

/**
 * isPointingLeft(landmarks)
 * Mirror image of isPointingRight.
 * In raw (un-mirrored) coords, pointing LEFT on screen = tip.x > wrist.x + threshold.
 *
 * @param {Array} landmarks
 * @returns {boolean}
 */
function isPointingLeft(landmarks) {
  const indexExtended  = isFingerExtended(landmarks, LM.INDEX_TIP,  LM.INDEX_MCP);
  const middleCurled   = !isFingerExtended(landmarks, LM.MIDDLE_TIP, LM.MIDDLE_MCP);
  const ringCurled     = !isFingerExtended(landmarks, LM.RING_TIP,   LM.RING_MCP);
  const pinkyCurled    = !isFingerExtended(landmarks, LM.PINKY_TIP,  LM.PINKY_MCP);

  // Index tip to the RIGHT in raw coords = pointing LEFT in mirrored preview
  const pointingHorizontally =
    landmarks[LM.INDEX_TIP].x > landmarks[LM.WRIST].x + POINT_THRESHOLD;

  return indexExtended && middleCurled && ringCurled && pinkyCurled && pointingHorizontally;
}


// ─── 10. CANVAS DRAWING (HAND SKELETON) ───────────────────────
/**
 * drawHandSkeleton(landmarks)
 * Draws the hand skeleton (bones + joint dots) on the canvas overlay.
 *
 * Landmark coordinates from MediaPipe are normalized (0–1).
 * We multiply by canvas dimensions to get pixel positions.
 *
 * @param {Array} landmarks - Array of 21 {x, y, z} landmark objects
 */
function drawHandSkeleton(landmarks) {
  /*
    The canvas has the same CSS scaleX(-1) mirror flip as the video,
    so we DON'T need to flip the coordinates manually — just draw them as-is.
  */

  // Helper: convert normalized coords to canvas pixels
  const px = (lm) => ({
    x: lm.x * canvasEl.width,
    y: lm.y * canvasEl.height
  });

  /*
    CONNECTIONS: each pair [a, b] draws a "bone" line between two landmarks.
    This is the standard MediaPipe hand skeleton connection list.
  */
  const connections = [
    // Thumb
    [0, 1], [1, 2], [2, 3], [3, 4],
    // Index finger
    [0, 5], [5, 6], [6, 7], [7, 8],
    // Middle finger
    [0, 9], [9, 10], [10, 11], [11, 12],
    // Ring finger
    [0, 13], [13, 14], [14, 15], [15, 16],
    // Pinky
    [0, 17], [17, 18], [18, 19], [19, 20],
    // Palm
    [5, 9], [9, 13], [13, 17],
  ];

  // Draw bone lines
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.85)'; // accent blue
  ctx.lineWidth   = 2;

  connections.forEach(([a, b]) => {
    const ptA = px(landmarks[a]);
    const ptB = px(landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(ptA.x, ptA.y);
    ctx.lineTo(ptB.x, ptB.y);
    ctx.stroke();
  });

  // Draw joint dots on top of the lines
  landmarks.forEach((lm, index) => {
    const pt = px(lm);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);

    // Fingertips (indices 4, 8, 12, 16, 20) get a pink accent dot
    const isTip = [4, 8, 12, 16, 20].includes(index);
    ctx.fillStyle = isTip ? '#f06292' : '#4fc3f7';
    ctx.fill();
  });
}


// ─── 11. EVENT LISTENERS ──────────────────────────────────────
/*
  Wire up all the control buttons. These provide keyboard-less
  fallback controls in addition to gesture control.
*/
btnNext.addEventListener('click',      nextSlide);
btnPrev.addEventListener('click',      prevSlide);
btnPlayPause.addEventListener('click', toggleVideo);
btnCamera.addEventListener('click',    startCamera);

/*
  Keyboard shortcut support — a nice bonus for accessibility.
  Arrow keys navigate slides; Space bar plays/pauses.
*/
document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowRight': nextSlide();    break;
    case 'ArrowLeft':  prevSlide();    break;
    case ' ':
      e.preventDefault();              // stop page from scrolling on Space
      toggleVideo();
      break;
  }
});


// ─── HELPER FUNCTIONS ─────────────────────────────────────────
/**
 * setGestureLabel(icon, text)
 * Updates the gesture status badge at the top of the screen.
 *
 * @param {string} icon - an emoji character
 * @param {string} text - short description of the gesture
 */
function setGestureLabel(icon, text) {
  gestureIcon.textContent  = icon;
  gestureLabel.textContent = text;
}


// ─── PAGE START — AUTO-INIT ───────────────────────────────────
/*
  Kick off the AI model download immediately when the page loads.
  The loading screen is already visible (it's in the HTML with no
  'done' class), so the user sees the progress bar right away.

  We don't wait for the user to click "Start Camera" — the model
  download takes 5–15 seconds and we want that time used productively
  while the user is still reading slide 1.
*/
setProgress(5, 'Loading page…');
initHandLandmarker();
