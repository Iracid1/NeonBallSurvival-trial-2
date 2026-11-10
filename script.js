"use strict";

/* ==========================================================================
   NEON BALL SURVIVAL
   A 2D arcade survival game made with plain HTML, CSS and JavaScript.

   How this file is organised (search for the numbered headings):
      1. Configuration       – every tunable number lives here
      2. Page elements        – references to HTML elements
      3. Helper functions
      4. Saved data           – best scores and settings (localStorage)
      5. Sound                – a tiny synthesiser using the Web Audio API
      6. Keyboard input
      7. Canvas sizing        – fits the fixed-size arena into any window
      8. Game state           – one object holds everything about a run
      9. Spawning             – coins, power-ups and enemies
     10. Updating the world   – player, enemies, pickups, difficulty
     11. Collisions & damage
     12. Visual effects       – particles, rings, floating text
     13. Drawing
     14. HUD
     15. Screens & game flow  – menu, countdown, pause, game over
     16. Main loop & start-up
   ========================================================================== */


/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */

// The arena always uses these internal ("world") dimensions. The canvas is
// scaled to fit the window, so gameplay is identical on every screen size.
const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const TAU = Math.PI * 2;

// Physics is simulated in small slices so fast objects (like a dash) can't
// skip through enemies or walls between two frames.
const MAX_PHYSICS_STEP = 1 / 120;
// If the browser stutters, never simulate more than this much time at once.
const MAX_FRAME_TIME = 1 / 30;

const COLORS = {
  background: "#05060d",
  arenaFloor: "#070b1a",
  player: "#2ef2ff",
  coin: "#ffd84a",
  danger: "#ff3b5c",
  text: "#e8f1ff",
};

const PLAYER_CONFIG = {
  radius: 16,
  maxLives: 3,
  speed: 340,               // pixels per second
  acceleration: 11,         // how quickly the ball reaches full speed (higher = snappier)
  wallBounce: 0.55,         // fraction of speed kept when bouncing off a wall
  minBounceSpeed: 140,      // slower wall hits just stop instead of bouncing (prevents jitter)
  hurtInvulnerability: 1.6, // seconds of protection after being hit
  dashSpeed: 1050,
  dashDuration: 0.16,
  dashInvulnerability: 0.25,
  dashCooldown: 2.0,
  trailLength: 12,
};

const SPEED_BOOST_MULTIPLIER = 1.6; // Speed Boost never stacks: it is either on or off
const CHRONO_TIME_SCALE = 0.4;      // enemies move at 40% speed during Chrono
const MAGNET_RADIUS = 280;
const NOVA_RADIUS = 340;

const DIFFICULTIES = {
  easy: {
    label: "Easy",
    enemySpeed: 0.85,
    spawnRate: 0.75,
    scoreMultiplier: 0.75,
    note: "Slower enemies and gentler spawns. Score ×0.75.",
  },
  normal: {
    label: "Normal",
    enemySpeed: 1,
    spawnRate: 1,
    scoreMultiplier: 1,
    note: "The intended arcade experience. Score ×1.",
  },
  hard: {
    label: "Hard",
    enemySpeed: 1.15,
    spawnRate: 1.3,
    scoreMultiplier: 1.5,
    note: "Faster, more frequent enemies. Score ×1.5.",
  },
};

// Every LEVEL_DURATION seconds the level goes up by one.
const LEVEL_DURATION = 25;

// Difficulty curve: each level spawns enemies a little more often, makes
// them a little faster and allows a few more on screen. Every value has a
// cap, so the game gets hard but never becomes impossible.
function getLevelStats(level) {
  const steps = level - 1;
  return {
    spawnInterval: Math.max(0.9, 3.0 * Math.pow(0.88, steps)),
    enemySpeedMultiplier: Math.min(1.55, 1 + 0.06 * steps),
    maxEnemies: Math.min(22, 4 + level * 2),
  };
}

const ENEMY_TYPES = {
  chaser: {
    name: "Chaser",
    color: "#ff3b5c",
    radius: 14,
    speed: 150,
    turnRate: 3,
    unlockLevel: 1,
    spawnWeight: 5,
    description: "Relentlessly hunts you down.",
  },
  dasher: {
    name: "Dasher",
    color: "#ff8c1a",
    radius: 15,
    speed: 90,
    turnRate: 2.5,
    unlockLevel: 2,
    spawnWeight: 2.5,
    triggerRange: 430,  // starts winding up when this close to the player
    windupTime: 0.75,
    chargeSpeed: 640,
    chargeTime: 0.55,
    restTime: 1.1,
    description: "Locks on, then charges in a straight line.",
  },
  swarmer: {
    name: "Swarmer",
    color: "#ff5fa2",
    radius: 9,
    speed: 200,
    turnRate: 2,
    unlockLevel: 3,
    spawnWeight: 2,
    groupSize: 3,
    description: "Fast and erratic. Arrives in packs.",
  },
  brute: {
    name: "Brute",
    color: "#e0193f",
    radius: 28,
    speed: 70,
    turnRate: 1.2,
    unlockLevel: 5,
    spawnWeight: 1,
    pullRange: 260,
    pullStrength: 120, // pixels per second when right next to it
    description: "Slow, but its gravity drags you in.",
  },
};

const POWERUP_TYPES = {
  shield: {
    label: "Shield",
    color: "#b26bff",
    duration: 6,
    spawnWeight: 3,
    description: "Invulnerable. Smash enemies on contact.",
  },
  speed: {
    label: "Speed Boost",
    color: "#3dff8b",
    duration: 6,
    spawnWeight: 3,
    description: "Move 60% faster for a few seconds.",
  },
  magnet: {
    label: "Coin Magnet",
    color: "#4d7cff",
    duration: 8,
    spawnWeight: 3,
    description: "Pulls nearby coins toward you.",
  },
  chrono: {
    label: "Chrono",
    color: "#e8eeff",
    duration: 5,
    spawnWeight: 2,
    description: "Slows every enemy to a crawl.",
  },
  nova: {
    label: "Nova Blast",
    color: "#ff4fd8",
    duration: 0, // instant effect
    spawnWeight: 2,
    description: "Instant shockwave that destroys nearby enemies.",
  },
  repair: {
    label: "Extra Life",
    color: "#ff8fb1",
    duration: 0, // instant effect
    spawnWeight: 1.5,
    onlyWhenHurt: true,
    description: "Restores one life (only appears when hurt).",
  },
};

// Power-ups that last for a while (as opposed to instant ones like Nova).
const TIMED_POWERUPS = Object.keys(POWERUP_TYPES).filter((key) => POWERUP_TYPES[key].duration > 0);

const COIN_CONFIG = {
  radius: 11,
  startingCoins: 4,
  maxActive: 7,
  spawnInterval: 1.1,
  points: 100,
  minPlayerDistance: 120, // coins never appear right on top of the player
  starChance: 0.08,       // chance that a new coin is a rare Star Coin
  starRadius: 15,
  starValue: 5,
  starLifetime: 9,
};

const COMBO_CONFIG = {
  window: 2.2,       // seconds you have to grab the next coin to keep the combo
  maxMultiplier: 5,
};

const POWERUP_CONFIG = {
  radius: 18,
  lifetime: 11,       // uncollected power-ups disappear after this many seconds
  firstSpawnDelay: 7,
  minInterval: 9,
  maxInterval: 14,
  maxActive: 2,
  minPlayerDistance: 160,
};

const ENEMY_SPAWN_CONFIG = {
  firstSpawnDelay: 1.5,
  warningTime: 0.9,       // a warning marker shows where an enemy will appear
  minPlayerDistance: 320,
  edgeInset: 50,
};

const SCORE_CONFIG = {
  perSecondSurvived: 10,
  perEnemyDestroyed: 75,
  fullLifeBonus: 500, // given by Extra Life when you are already at full health
};

const COIN_RUSH_CONFIG = {
  interval: 60,     // a Coin Rush event happens every minute
  coinCount: 10,
  coinLifetime: 10, // rush coins vanish if you don't grab them in time
};

const MAX_PARTICLES = 500;
const GRID_SIZE = 40;


/* ==========================================================================
   2. PAGE ELEMENTS
   ========================================================================== */

const byId = (id) => document.getElementById(id);

const ui = {
  stage: byId("stage"),
  canvas: byId("game-canvas"),
  score: byId("hud-score"),
  scoreStat: byId("hud-score-stat"),
  coins: byId("hud-coins"),
  coinsStat: byId("hud-coins-stat"),
  time: byId("hud-time"),
  level: byId("hud-level"),
  lives: byId("hud-lives"),
  dashMeter: byId("hud-dash"),
  dashFill: byId("hud-dash-fill"),
  combo: byId("hud-combo"),
  comboValue: byId("hud-combo-value"),
  comboFill: byId("hud-combo-fill"),
  powerupChips: byId("hud-powerups"),
  muteButtons: document.querySelectorAll("[data-action='mute']"),
  muteLabels: document.querySelectorAll(".mute-label"),
  pauseButton: byId("pause-btn"),
  announcement: byId("announcement"),
  announcementTitle: byId("announcement-title"),
  announcementSubtitle: byId("announcement-subtitle"),
  countdown: byId("countdown"),
  toasts: byId("toasts"),
  startScreen: byId("start-screen"),
  pauseScreen: byId("pause-screen"),
  gameOverScreen: byId("gameover-screen"),
  playButton: byId("play-btn"),
  difficultyButtons: document.querySelectorAll("[data-difficulty]"),
  difficultyNote: byId("difficulty-note"),
  bestLabel: byId("best-difficulty-label"),
  bestScore: byId("best-score"),
  bestTime: byId("best-time"),
  bestCoins: byId("best-coins"),
  fieldGuide: byId("field-guide"),
  resumeButton: byId("resume-btn"),
  restartButton: byId("restart-btn"),
  pauseMenuButton: byId("pause-menu-btn"),
  playAgainButton: byId("play-again-btn"),
  gameOverMenuButton: byId("gameover-menu-btn"),
  gameOverSubtitle: byId("gameover-subtitle"),
  finalScore: byId("final-score"),
  finalCoins: byId("final-coins"),
  finalTime: byId("final-time"),
  finalLevel: byId("final-level"),
  finalKills: byId("final-kills"),
  bestScoreBadge: byId("best-score-badge"),
  bestTimeBadge: byId("best-time-badge"),
  bestCoinsBadge: byId("best-coins-badge"),
};

const ctx = ui.canvas.getContext("2d");


/* ==========================================================================
   3. HELPER FUNCTIONS
   ========================================================================== */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);
const distanceBetween = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const circlesOverlap = (a, b) => distanceBetween(a.x, a.y, b.x, b.y) < a.radius + b.radius;

// Frame-rate independent smoothing: returns how far (0–1) to move toward a
// target this step. Using exp() means the result is the same at 30 or 144 FPS.
const smoothFactor = (rate, dt) => 1 - Math.exp(-rate * dt);

// Picks a random key from a list of { key, weight } entries.
function pickWeighted(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.key;
  }
  return entries[entries.length - 1].key;
}

function formatTime(seconds, showTenths = false) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  let text = `${minutes}:${String(wholeSeconds).padStart(2, "0")}`;
  if (showTenths) text += `.${Math.floor((safeSeconds * 10) % 10)}`;
  return text;
}

const formatNumber = (value) => Math.floor(value).toLocaleString("en-US");

// Re-triggers a CSS animation, even if it is already playing.
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // reading layout forces the browser to notice the removal
  element.classList.add(className);
}

function blurFocusedElement() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}


/* ==========================================================================
   4. SAVED DATA (best scores and settings)
   localStorage can be missing, full, blocked or contain garbage, so every
   read and write is wrapped in try/catch and every value is validated.
   ========================================================================== */

const STORAGE_KEYS = {
  records: "neonBallSurvival.records",
  settings: "neonBallSurvival.settings",
};

function readSavedJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeSavedJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage unavailable (e.g. private mode). The game still works without it.
  }
}

const safeNumber = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);

function loadRecords() {
  const saved = readSavedJson(STORAGE_KEYS.records);
  const records = {};
  for (const key of Object.keys(DIFFICULTIES)) {
    const entry = saved && typeof saved === "object" ? saved[key] : null;
    records[key] = {
      score: safeNumber(entry && entry.score),
      time: safeNumber(entry && entry.time),
      coins: safeNumber(entry && entry.coins),
    };
  }
  return records;
}

function loadSettings() {
  const saved = readSavedJson(STORAGE_KEYS.settings) || {};
  return {
    muted: saved.muted === true,
    difficulty: Object.hasOwn(DIFFICULTIES, saved.difficulty) ? saved.difficulty : "normal",
  };
}

function saveSettings() {
  writeSavedJson(STORAGE_KEYS.settings, { muted: Sound.muted, difficulty: game.difficultyKey });
}


/* ==========================================================================
   5. SOUND
   All sound effects are generated with the Web Audio API, so there are no
   audio files to load. Browsers only allow audio after the player interacts
   with the page, so the audio system is created on the first click or key.
   If audio is unavailable for any reason, the game simply stays silent.
   ========================================================================== */

const Sound = {
  context: null,
  masterGain: null,
  noiseBuffer: null,
  muted: false,
  volume: 0.45,

  unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        this.context = new AudioContextClass();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = this.muted ? 0 : this.volume;
        this.masterGain.connect(this.context.destination);
      } catch (error) {
        this.context = null;
        return;
      }
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
  },

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : this.volume;
  },

  canPlay() {
    return Boolean(this.context) && !this.muted && this.context.state === "running";
  },

  // A single beep whose pitch can slide from `frequency` to `endFrequency`.
  tone({ frequency, endFrequency, duration = 0.15, type = "sine", volume = 0.2, delay = 0 }) {
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    // Quick fade in and out so the sound doesn't "click".
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  },

  // A burst of filtered white noise, used for hits and explosions.
  noise({ duration = 0.3, volume = 0.2, filterFrequency = 1200, filterType = "lowpass", delay = 0 }) {
    if (!this.noiseBuffer) {
      const length = this.context.sampleRate;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(start);
    source.stop(start + duration + 0.05);
  },

  play(name, option) {
    const effect = SOUND_EFFECTS[name];
    if (!effect || !this.canPlay()) return;
    try {
      effect(option);
    } catch (error) {
      // Never let a sound problem crash the game.
    }
  },
};

const SOUND_EFFECTS = {
  coin(combo = 1) {
    // The pitch rises with the combo, which makes chaining coins feel great.
    const pitch = 700 * Math.pow(1.12, Math.min(combo, 8) - 1);
    Sound.tone({ frequency: pitch, endFrequency: pitch * 1.5, duration: 0.08, type: "square", volume: 0.07 });
    Sound.tone({ frequency: pitch * 1.5, duration: 0.16, type: "sine", volume: 0.14, delay: 0.05 });
  },
  star() {
    [880, 1109, 1319, 1760].forEach((frequency, i) =>
      Sound.tone({ frequency, duration: 0.18, type: "triangle", volume: 0.14, delay: i * 0.05 }));
  },
  powerup() {
    [392, 523, 659, 784].forEach((frequency, i) =>
      Sound.tone({ frequency, duration: 0.2, type: "triangle", volume: 0.16, delay: i * 0.06 }));
  },
  expire() {
    Sound.tone({ frequency: 520, endFrequency: 240, duration: 0.3, type: "triangle", volume: 0.12 });
  },
  hurt() {
    Sound.noise({ duration: 0.35, volume: 0.3, filterFrequency: 900 });
    Sound.tone({ frequency: 240, endFrequency: 60, duration: 0.35, type: "sawtooth", volume: 0.12 });
  },
  dash() {
    Sound.noise({ duration: 0.18, volume: 0.1, filterFrequency: 2200, filterType: "bandpass" });
    Sound.tone({ frequency: 260, endFrequency: 820, duration: 0.14, type: "sine", volume: 0.1 });
  },
  bounce() {
    Sound.tone({ frequency: 200, endFrequency: 90, duration: 0.07, type: "triangle", volume: 0.12 });
  },
  spawn() {
    Sound.tone({ frequency: 110, endFrequency: 220, duration: 0.25, type: "sine", volume: 0.05 });
  },
  kill() {
    Sound.tone({ frequency: 420, endFrequency: 70, duration: 0.15, type: "square", volume: 0.06 });
  },
  charge() {
    Sound.tone({ frequency: 160, endFrequency: 480, duration: 0.2, type: "sawtooth", volume: 0.035 });
  },
  nova() {
    Sound.noise({ duration: 0.7, volume: 0.3, filterFrequency: 600 });
    Sound.tone({ frequency: 180, endFrequency: 35, duration: 0.6, type: "sine", volume: 0.3 });
  },
  levelUp() {
    [523, 659, 784, 1047].forEach((frequency, i) =>
      Sound.tone({ frequency, duration: 0.22, type: "square", volume: 0.05, delay: i * 0.08 }));
  },
  countdown() {
    Sound.tone({ frequency: 440, duration: 0.12, type: "square", volume: 0.06 });
  },
  go() {
    Sound.tone({ frequency: 880, duration: 0.3, type: "square", volume: 0.07 });
  },
  explode() {
    Sound.noise({ duration: 1.0, volume: 0.35, filterFrequency: 500 });
    Sound.tone({ frequency: 120, endFrequency: 30, duration: 0.8, type: "sine", volume: 0.3 });
  },
  gameOver() {
    [392, 330, 262, 196].forEach((frequency, i) =>
      Sound.tone({ frequency, duration: 0.35, type: "triangle", volume: 0.12, delay: i * 0.16 }));
  },
  click() {
    Sound.tone({ frequency: 660, duration: 0.05, type: "triangle", volume: 0.07 });
  },
};


/* ==========================================================================
   6. KEYBOARD INPUT
   We remember which keys are currently held in a Set. Movement reads that
   Set every physics step; one-off actions (dash, pause) react to keydown.
   `event.code` is the physical key, so WASD works on any keyboard layout.
   ========================================================================== */

const KEY_BINDINGS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  dash: ["Space", "ShiftLeft", "ShiftRight"],
};

// Keys whose default browser behaviour (scrolling, pressing buttons) we block during play.
const GAME_KEYS = new Set([...Object.values(KEY_BINDINGS).flat(), "Enter", "Escape", "KeyP", "KeyM"]);

const keysDown = new Set();

const isActionHeld = (action) => KEY_BINDINGS[action].some((code) => keysDown.has(code));

// Returns the movement direction as a vector of length 0 or 1. Normalising
// it is what stops diagonal movement from being faster than straight movement.
function getMovementInput() {
  let x = 0;
  let y = 0;
  if (isActionHeld("left")) x -= 1;
  if (isActionHeld("right")) x += 1;
  if (isActionHeld("up")) y -= 1;
  if (isActionHeld("down")) y += 1;
  const length = Math.hypot(x, y);
  if (length > 0) {
    x /= length;
    y /= length;
  }
  return { x, y };
}

function handleKeyDown(event) {
  Sound.unlock();
  const inGame = game.state === "playing" || game.state === "countdown";
  const onButton = event.target instanceof HTMLButtonElement;

  // During play, stop arrows/space from scrolling or "clicking" a focused button.
  // On menus, let Space/Enter work normally on buttons.
  if (GAME_KEYS.has(event.code) && (inGame || !onButton)) event.preventDefault();

  keysDown.add(event.code);
  if (event.repeat) return; // holding a key should not repeat one-off actions

  if (event.code === "KeyM") {
    toggleMute();
  } else if (event.code === "Escape" || event.code === "KeyP") {
    if (inGame) pauseGame();
    else if (game.state === "paused") resumeGame();
  } else if (KEY_BINDINGS.dash.includes(event.code)) {
    if (game.state === "playing") run.dashRequested = true;
  } else if (event.code === "Enter" && !onButton) {
    if (game.state === "menu" || game.state === "gameover") startRun();
  }
}

function handleKeyUp(event) {
  keysDown.delete(event.code);
}

// If the window loses focus we never receive the "keyup" events, which would
// leave keys stuck down. So we forget every key and pause the game.
function handleFocusLost() {
  keysDown.clear();
  if (game.state === "playing" || game.state === "countdown") pauseGame();
}

function bindInputEvents() {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleFocusLost);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) handleFocusLost();
  });
  window.addEventListener("pointerdown", () => Sound.unlock());
}


/* ==========================================================================
   7. CANVAS SIZING
   The canvas always fills the stage. The arena is drawn at a uniform scale
   and centred, so it is never stretched. Resizing only changes how the world
   is displayed – the game state is untouched.
   ========================================================================== */

const view = { scale: 1, offsetX: 0, offsetY: 0, pixelRatio: 1 };

function resizeCanvas() {
  const rect = ui.stage.getBoundingClientRect();
  // Rendering at the screen's pixel density keeps edges crisp (capped for speed).
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * pixelRatio));
  const height = Math.max(1, Math.floor(rect.height * pixelRatio));
  if (ui.canvas.width !== width || ui.canvas.height !== height) {
    ui.canvas.width = width;
    ui.canvas.height = height;
  }
  const margin = 14 * pixelRatio;
  view.pixelRatio = pixelRatio;
  view.scale = Math.max(0.05, Math.min((width - margin * 2) / WORLD_WIDTH, (height - margin * 2) / WORLD_HEIGHT));
  view.offsetX = (width - WORLD_WIDTH * view.scale) / 2;
  view.offsetY = (height - WORLD_HEIGHT * view.scale) / 2;
  // Canvas glow (shadowBlur) ignores scaling, so we store the scale to apply it manually.
  ctx.glowScale = view.scale;
}


/* ==========================================================================
   8. GAME STATE
   `game` holds things that survive between runs (settings, records, which
   screen is showing). `run` holds everything about the current attempt.
   Restarting simply replaces `run` with a fresh object, which guarantees
   that nothing from the previous run (enemies, timers, effects) leaks over.
   ========================================================================== */

const game = {
  // "menu" | "countdown" | "playing" | "paused" | "dying" | "gameover"
  state: "menu",
  stateBeforePause: null,
  difficultyKey: "normal",
  records: loadRecords(),
};

function createPlayer() {
  return {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: PLAYER_CONFIG.radius,
    lives: PLAYER_CONFIG.maxLives,
    hurtTimer: 0,     // > 0 while invulnerable after being hit
    dashTimer: 0,     // > 0 while the dash burst is happening
    dashGrace: 0,     // > 0 while the dash protects you
    dashCooldown: 0,  // > 0 until the next dash is ready
    facingX: 1,
    facingY: 0,
    trail: [],
    lastBounceSoundTime: 0,
  };
}

function createRunState() {
  return {
    player: createPlayer(),
    enemies: [],
    spawnWarnings: [],
    coins: [],
    powerups: [],
    rings: [],
    particles: [],
    floatingTexts: [],
    // Remaining seconds for each timed power-up (0 means inactive).
    effects: Object.fromEntries(TIMED_POWERUPS.map((key) => [key, 0])),
    time: 0,
    level: 1,
    levelStats: getLevelStats(1),
    score: 0,
    coinsCollected: 0,
    enemiesDestroyed: 0,
    combo: 0,
    comboTimer: 0,
    timers: {
      coinSpawn: COIN_CONFIG.spawnInterval,
      enemySpawn: ENEMY_SPAWN_CONFIG.firstSpawnDelay,
      powerupSpawn: POWERUP_CONFIG.firstSpawnDelay,
      coinRush: COIN_RUSH_CONFIG.interval,
    },
    countdown: 0,
    countdownShown: null,
    dyingTimer: 0,
    dashRequested: false,
    screenShake: 0,
    damageFlash: 0,
  };
}

let run = createRunState();

const getDifficulty = () => DIFFICULTIES[game.difficultyKey];

function setState(newState) {
  game.state = newState;
  document.body.dataset.state = newState; // lets the CSS react to the state
}

function isPlayerVulnerable() {
  const player = run.player;
  return player.hurtTimer <= 0 && player.dashGrace <= 0 && run.effects.shield <= 0;
}

function getPlayerMaxSpeed() {
  return PLAYER_CONFIG.speed * (run.effects.speed > 0 ? SPEED_BOOST_MULTIPLIER : 1);
}

function addScore(points) {
  run.score += points * getDifficulty().scoreMultiplier;
}


/* ==========================================================================
   9. SPAWNING
   ========================================================================== */

// Finds a random free spot in the arena, away from the player and from the
// other pickups. Returns null if no spot was found (we just try again later).
function findOpenPosition(radius, minPlayerDistance) {
  const margin = radius + 24;
  const pickups = [...run.coins, ...run.powerups];
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = randomBetween(margin, WORLD_WIDTH - margin);
    const y = randomBetween(margin, WORLD_HEIGHT - margin);
    if (distanceBetween(x, y, run.player.x, run.player.y) < minPlayerDistance) continue;
    const overlapsPickup = pickups.some((item) => distanceBetween(x, y, item.x, item.y) < item.radius + radius + 20);
    if (!overlapsPickup) return { x, y };
  }
  return null;
}

// `lifetime` is how many seconds the coin stays (null = until collected).
function spawnCoin({ allowStar = true, lifetime = null } = {}) {
  const isStar = allowStar && Math.random() < COIN_CONFIG.starChance;
  const radius = isStar ? COIN_CONFIG.starRadius : COIN_CONFIG.radius;
  const position = findOpenPosition(radius, COIN_CONFIG.minPlayerDistance);
  if (!position) return;
  run.coins.push({
    x: position.x,
    y: position.y,
    radius,
    isStar,
    lifetime: isStar ? COIN_CONFIG.starLifetime : lifetime,
    age: 0,
    spinOffset: Math.random() * TAU,
  });
  spawnRing(position.x, position.y, isStar ? "#ffe66b" : COLORS.coin, radius * 3, 160, 1.5);
}

function choosePowerupType() {
  const options = Object.keys(POWERUP_TYPES)
    .filter((key) => !POWERUP_TYPES[key].onlyWhenHurt || run.player.lives < PLAYER_CONFIG.maxLives)
    .map((key) => ({ key, weight: POWERUP_TYPES[key].spawnWeight }));
  return pickWeighted(options);
}

function spawnPowerup() {
  const position = findOpenPosition(POWERUP_CONFIG.radius, POWERUP_CONFIG.minPlayerDistance);
  if (!position) return;
  const type = choosePowerupType();
  run.powerups.push({
    x: position.x,
    y: position.y,
    radius: POWERUP_CONFIG.radius,
    type,
    age: 0,
  });
  spawnRing(position.x, position.y, POWERUP_TYPES[type].color, 60, 140, 2);
}

function chooseEnemyType() {
  const options = Object.keys(ENEMY_TYPES)
    .filter((key) => ENEMY_TYPES[key].unlockLevel <= run.level)
    .map((key) => ({ key, weight: ENEMY_TYPES[key].spawnWeight }));
  return pickWeighted(options);
}

// Enemies appear near the arena edges and never close to the player.
function findEnemySpawnPoint() {
  const inset = ENEMY_SPAWN_CONFIG.edgeInset;
  for (let attempt = 0; attempt < 30; attempt++) {
    const side = Math.floor(Math.random() * 4);
    const along = Math.random();
    const x = side === 0 ? inset : side === 1 ? WORLD_WIDTH - inset : inset + along * (WORLD_WIDTH - inset * 2);
    const y = side === 2 ? inset : side === 3 ? WORLD_HEIGHT - inset : inset + along * (WORLD_HEIGHT - inset * 2);
    if (distanceBetween(x, y, run.player.x, run.player.y) >= ENEMY_SPAWN_CONFIG.minPlayerDistance) return { x, y };
  }
  // Fallback: the corner furthest from the player.
  return {
    x: run.player.x < WORLD_WIDTH / 2 ? WORLD_WIDTH - inset : inset,
    y: run.player.y < WORLD_HEIGHT / 2 ? WORLD_HEIGHT - inset : inset,
  };
}

// Instead of popping in instantly, enemies are announced by a warning marker.
// This is fairer: the player always has a moment to react.
function queueEnemySpawn(typeKey) {
  const point = findEnemySpawnPoint();
  run.spawnWarnings.push({
    x: point.x,
    y: point.y,
    type: typeKey,
    timer: ENEMY_SPAWN_CONFIG.warningTime,
  });
  Sound.play("spawn");
}

function createEnemy(typeKey, x, y) {
  const type = ENEMY_TYPES[typeKey];
  return {
    type: typeKey,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: type.radius,
    age: 0,
    seed: Math.random() * TAU, // makes each enemy's animation slightly different
    wobble: Math.random() * TAU,
    // Only Dashers use these, for their approach → windup → charge → rest cycle.
    mode: "approach",
    modeTimer: 0.6,
    aimX: 1,
    aimY: 0,
  };
}

function spawnEnemiesFromWarning(warning) {
  const type = ENEMY_TYPES[warning.type];
  const count = type.groupSize || 1;
  for (let i = 0; i < count; i++) {
    const offsetAngle = (i / count) * TAU;
    const offset = count > 1 ? 22 : 0;
    const x = clamp(warning.x + Math.cos(offsetAngle) * offset, type.radius, WORLD_WIDTH - type.radius);
    const y = clamp(warning.y + Math.sin(offsetAngle) * offset, type.radius, WORLD_HEIGHT - type.radius);
    run.enemies.push(createEnemy(warning.type, x, y));
  }
  spawnParticles(warning.x, warning.y, type.color, 14, { speed: 200, size: 3 });
}

function countThreats() {
  const pending = run.spawnWarnings.reduce((sum, warning) => sum + (ENEMY_TYPES[warning.type].groupSize || 1), 0);
  return run.enemies.length + pending;
}

function updateSpawning(dt) {
  const timers = run.timers;

  timers.coinSpawn -= dt;
  if (timers.coinSpawn <= 0) {
    timers.coinSpawn = COIN_CONFIG.spawnInterval;
    if (run.coins.length < COIN_CONFIG.maxActive) spawnCoin();
  }

  timers.powerupSpawn -= dt;
  if (timers.powerupSpawn <= 0) {
    timers.powerupSpawn = randomBetween(POWERUP_CONFIG.minInterval, POWERUP_CONFIG.maxInterval);
    if (run.powerups.length < POWERUP_CONFIG.maxActive) spawnPowerup();
  }

  timers.enemySpawn -= dt;
  if (timers.enemySpawn <= 0) {
    timers.enemySpawn = run.levelStats.spawnInterval / getDifficulty().spawnRate;
    const typeKey = chooseEnemyType();
    const groupSize = ENEMY_TYPES[typeKey].groupSize || 1;
    if (countThreats() + groupSize <= run.levelStats.maxEnemies) queueEnemySpawn(typeKey);
  }

  // Arena event: every minute a burst of coins rewards the player for surviving.
  timers.coinRush -= dt;
  if (timers.coinRush <= 0) {
    timers.coinRush = COIN_RUSH_CONFIG.interval;
    startCoinRush();
  }
}

function startCoinRush() {
  for (let i = 0; i < COIN_RUSH_CONFIG.coinCount; i++) {
    spawnCoin({ allowStar: i === 0, lifetime: COIN_RUSH_CONFIG.coinLifetime });
  }
  announce("Coin Rush!", "Grab the gold while it lasts", COLORS.coin);
  Sound.play("star");
}


/* ==========================================================================
   10. UPDATING THE WORLD
   ========================================================================== */

// Runs one small slice of gameplay. Called several times per frame if needed.
function simulateStep(dt) {
  run.time += dt;
  addScore(SCORE_CONFIG.perSecondSurvived * dt);

  updateDifficulty();
  updateEffects(dt);
  updateCombo(dt);
  updatePlayer(dt);
  updateEnemies(dt);
  updateSpawnWarnings(dt);
  updateCoins(dt);
  updatePowerups(dt);
  handleCollisions();
  if (game.state !== "playing") return; // the player may have just lost their last life
  updateSpawning(dt);
  updateVisualEffects(dt);
}

function updateDifficulty() {
  const newLevel = 1 + Math.floor(run.time / LEVEL_DURATION);
  if (newLevel <= run.level) return;

  run.level = newLevel;
  run.levelStats = getLevelStats(newLevel);
  const newEnemy = Object.values(ENEMY_TYPES).find((type) => type.unlockLevel === newLevel);
  const message = newEnemy ? `${newEnemy.name}s have entered the arena!` : "The hunters grow faster…";
  announce(`Level ${newLevel}`, message, `hsl(${getArenaHue()}, 100%, 65%)`);
  Sound.play("levelUp");
}

// Counts down each active power-up and announces when one runs out.
// Effects are only ever set to their full duration (never added together),
// and are clamped at 0, so they can't become permanent or stack forever.
function updateEffects(dt) {
  for (const key of TIMED_POWERUPS) {
    if (run.effects[key] <= 0) continue;
    run.effects[key] = Math.max(0, run.effects[key] - dt);
    if (run.effects[key] === 0) {
      showToast(`${POWERUP_TYPES[key].label} expired`, POWERUP_TYPES[key].color);
      Sound.play("expire");
    }
  }
}

function updateCombo(dt) {
  if (run.comboTimer <= 0) return;
  run.comboTimer -= dt;
  if (run.comboTimer <= 0) {
    run.comboTimer = 0;
    run.combo = 0;
  }
}

function updatePlayer(dt) {
  const player = run.player;
  const input = getMovementInput();
  if (input.x !== 0 || input.y !== 0) {
    player.facingX = input.x;
    player.facingY = input.y;
  }

  player.hurtTimer = Math.max(0, player.hurtTimer - dt);
  player.dashGrace = Math.max(0, player.dashGrace - dt);
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);

  if (run.dashRequested) {
    run.dashRequested = false;
    tryDash(input);
  }

  if (player.dashTimer > 0) {
    // While dashing, the ball keeps its burst of speed instead of steering.
    player.dashTimer -= dt;
    if (Math.random() < 0.5) spawnParticles(player.x, player.y, "#ffffff", 1, { speed: 40, size: 3, life: 0.35 });
  } else {
    // Ease the velocity toward the target velocity rather than setting it
    // directly. This gives the ball a little weight but stays responsive.
    const maxSpeed = getPlayerMaxSpeed();
    const blend = smoothFactor(PLAYER_CONFIG.acceleration, dt);
    player.vx += (input.x * maxSpeed - player.vx) * blend;
    player.vy += (input.y * maxSpeed - player.vy) * blend;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  applyBrutePull(player, dt);

  const impactSpeed = bounceOffWalls(player, PLAYER_CONFIG.wallBounce, PLAYER_CONFIG.minBounceSpeed);
  if (impactSpeed > 220) onPlayerWallImpact(impactSpeed);

  if (run.effects.speed > 0 && Math.hypot(player.vx, player.vy) > 200 && Math.random() < 0.4) {
    spawnParticles(player.x, player.y, POWERUP_TYPES.speed.color, 1, { speed: 30, size: 2.5, life: 0.4 });
  }
}

function tryDash(input) {
  const player = run.player;
  if (player.dashCooldown > 0) return;

  // Dash in the held direction, or the last direction moved if no key is held.
  let directionX = input.x;
  let directionY = input.y;
  if (directionX === 0 && directionY === 0) {
    directionX = player.facingX;
    directionY = player.facingY;
  }
  player.vx = directionX * PLAYER_CONFIG.dashSpeed;
  player.vy = directionY * PLAYER_CONFIG.dashSpeed;
  player.dashTimer = PLAYER_CONFIG.dashDuration;
  player.dashGrace = PLAYER_CONFIG.dashInvulnerability;
  player.dashCooldown = PLAYER_CONFIG.dashCooldown;

  const backwards = Math.atan2(-directionY, -directionX);
  spawnParticles(player.x, player.y, COLORS.player, 16, { speed: 260, size: 3, angle: backwards, spread: 1.2 });
  spawnRing(player.x, player.y, "#ffffff", 50, 300, 2);
  Sound.play("dash");
}

// Keeps a circle inside the arena. Only the part of the velocity pointing
// INTO the wall is reversed, so the ball keeps sliding along the wall in the
// direction the player intended. Weak hits just stop (no jittery micro-bounces).
// Returns how fast the body hit a wall (0 if it didn't).
function bounceOffWalls(body, bounce, minBounceSpeed = 0) {
  let impactSpeed = 0;
  const r = body.radius;
  const reflect = (speedIntoWall) => (speedIntoWall > minBounceSpeed ? speedIntoWall * bounce : 0);

  if (body.x < r) {
    body.x = r;
    if (body.vx < 0) {
      impactSpeed = Math.max(impactSpeed, -body.vx);
      body.vx = reflect(-body.vx);
    }
  } else if (body.x > WORLD_WIDTH - r) {
    body.x = WORLD_WIDTH - r;
    if (body.vx > 0) {
      impactSpeed = Math.max(impactSpeed, body.vx);
      body.vx = -reflect(body.vx);
    }
  }

  if (body.y < r) {
    body.y = r;
    if (body.vy < 0) {
      impactSpeed = Math.max(impactSpeed, -body.vy);
      body.vy = reflect(-body.vy);
    }
  } else if (body.y > WORLD_HEIGHT - r) {
    body.y = WORLD_HEIGHT - r;
    if (body.vy > 0) {
      impactSpeed = Math.max(impactSpeed, body.vy);
      body.vy = -reflect(body.vy);
    }
  }
  return impactSpeed;
}

function onPlayerWallImpact(impactSpeed) {
  const player = run.player;
  spawnParticles(player.x, player.y, COLORS.player, Math.min(14, Math.floor(impactSpeed / 60)), { speed: 180, size: 2.5, life: 0.4 });
  if (impactSpeed > 600) run.screenShake = Math.max(run.screenShake, 5);
  // Avoid machine-gun sounds when sliding along a wall.
  if (run.time - player.lastBounceSoundTime > 0.12) {
    player.lastBounceSoundTime = run.time;
    Sound.play("bounce");
  }
}

// Brutes have a gravity field that drags the player toward them.
function applyBrutePull(player, dt) {
  if (player.dashTimer > 0) return; // a dash always breaks free
  const brute = ENEMY_TYPES.brute;
  const slowdown = run.effects.chrono > 0 ? CHRONO_TIME_SCALE : 1;
  for (const enemy of run.enemies) {
    if (enemy.type !== "brute") continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > brute.pullRange || distance < 1) continue;
    // The pull grows stronger the closer you are.
    const strength = brute.pullStrength * (1 - distance / brute.pullRange) * slowdown;
    player.x += (dx / distance) * strength * dt;
    player.y += (dy / distance) * strength * dt;
  }
}

// Smoothly turns an enemy's velocity toward a target point.
// A low turnRate makes wide, drifting turns; a high one makes tight turns.
function steerToward(enemy, targetX, targetY, speed, turnRate, dt) {
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const blend = smoothFactor(turnRate, dt);
  enemy.vx += ((dx / distance) * speed - enemy.vx) * blend;
  enemy.vy += ((dy / distance) * speed - enemy.vy) * blend;
}

// Each enemy type has its own movement behaviour.
const ENEMY_BEHAVIOURS = {
  chaser(enemy, dt, speedMultiplier) {
    const type = ENEMY_TYPES.chaser;
    steerToward(enemy, run.player.x, run.player.y, type.speed * speedMultiplier, type.turnRate, dt);
  },

  swarmer(enemy, dt, speedMultiplier) {
    // Swarmers weave side to side as they close in, so a pack spreads out.
    const type = ENEMY_TYPES.swarmer;
    const player = run.player;
    enemy.wobble += dt * 5;
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    const sideways = Math.sin(enemy.wobble) * Math.min(90, distance * 0.5);
    const targetX = player.x + (-dy / distance) * sideways;
    const targetY = player.y + (dx / distance) * sideways;
    steerToward(enemy, targetX, targetY, type.speed * speedMultiplier, type.turnRate, dt);
  },

  brute(enemy, dt, speedMultiplier) {
    const type = ENEMY_TYPES.brute;
    steerToward(enemy, run.player.x, run.player.y, type.speed * speedMultiplier, type.turnRate, dt);
  },

  // Dashers follow a simple cycle: approach → windup (telegraph) → charge → rest.
  dasher(enemy, dt, speedMultiplier) {
    const type = ENEMY_TYPES.dasher;
    const player = run.player;
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    enemy.modeTimer -= dt;

    switch (enemy.mode) {
      case "approach":
        steerToward(enemy, player.x, player.y, type.speed * speedMultiplier, type.turnRate, dt);
        enemy.aimX = dx / distance;
        enemy.aimY = dy / distance;
        if (distance < type.triggerRange && enemy.modeTimer <= 0) {
          enemy.mode = "windup";
          enemy.modeTimer = type.windupTime;
        }
        break;

      case "windup":
        // Brake to a stop while aiming at the player (the dashed line shows the aim).
        enemy.vx *= Math.exp(-8 * dt);
        enemy.vy *= Math.exp(-8 * dt);
        enemy.aimX = dx / distance;
        enemy.aimY = dy / distance;
        if (enemy.modeTimer <= 0) {
          const chargeSpeed = type.chargeSpeed * Math.min(speedMultiplier, 1.3);
          enemy.mode = "charge";
          enemy.modeTimer = type.chargeTime;
          enemy.vx = enemy.aimX * chargeSpeed;
          enemy.vy = enemy.aimY * chargeSpeed;
          Sound.play("charge");
        }
        break;

      case "charge": {
        // Fly straight. Walls bounce it (see updateEnemies), so keep the aim in sync.
        const speed = Math.hypot(enemy.vx, enemy.vy) || 1;
        enemy.aimX = enemy.vx / speed;
        enemy.aimY = enemy.vy / speed;
        if (enemy.modeTimer <= 0) {
          enemy.mode = "rest";
          enemy.modeTimer = type.restTime;
        }
        break;
      }

      case "rest":
        enemy.vx *= Math.exp(-4 * dt);
        enemy.vy *= Math.exp(-4 * dt);
        if (enemy.modeTimer <= 0) {
          enemy.mode = "approach";
          enemy.modeTimer = 0.4;
        }
        break;
    }
  },
};

function updateEnemies(dt) {
  // Chrono slows enemies down by simply giving them less time to move.
  const enemyDt = dt * (run.effects.chrono > 0 ? CHRONO_TIME_SCALE : 1);
  const speedMultiplier = run.levelStats.enemySpeedMultiplier * getDifficulty().enemySpeed;

  for (const enemy of run.enemies) {
    enemy.age += dt;
    ENEMY_BEHAVIOURS[enemy.type](enemy, enemyDt, speedMultiplier);
    enemy.x += enemy.vx * enemyDt;
    enemy.y += enemy.vy * enemyDt;
    bounceOffWalls(enemy, enemy.mode === "charge" ? 1 : 0.6);
  }
  separateEnemies();
}

// Gently pushes overlapping enemies apart so they don't merge into one blob.
// Bigger enemies push smaller ones more than they get pushed themselves.
function separateEnemies() {
  const enemies = run.enemies;
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i];
      const b = enemies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistance = a.radius + b.radius;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= minDistance * minDistance || distanceSquared === 0) continue;

      const distance = Math.sqrt(distanceSquared);
      const overlap = minDistance - distance;
      const nx = dx / distance;
      const ny = dy / distance;
      const totalSize = a.radius + b.radius;
      a.x -= nx * overlap * (b.radius / totalSize);
      a.y -= ny * overlap * (b.radius / totalSize);
      b.x += nx * overlap * (a.radius / totalSize);
      b.y += ny * overlap * (a.radius / totalSize);
    }
  }
  for (const enemy of enemies) {
    enemy.x = clamp(enemy.x, enemy.radius, WORLD_WIDTH - enemy.radius);
    enemy.y = clamp(enemy.y, enemy.radius, WORLD_HEIGHT - enemy.radius);
  }
}

function updateSpawnWarnings(dt) {
  for (let i = run.spawnWarnings.length - 1; i >= 0; i--) {
    const warning = run.spawnWarnings[i];
    warning.timer -= dt;
    if (warning.timer <= 0) {
      run.spawnWarnings.splice(i, 1);
      spawnEnemiesFromWarning(warning);
    }
  }
}

function updateCoins(dt) {
  const player = run.player;
  const magnetActive = run.effects.magnet > 0;

  for (let i = run.coins.length - 1; i >= 0; i--) {
    const coin = run.coins[i];
    coin.age += dt;

    // Star Coins and Coin Rush coins only stay for a short time.
    if (coin.lifetime !== null && coin.age >= coin.lifetime) {
      spawnParticles(coin.x, coin.y, coin.isStar ? "#ffe66b" : COLORS.coin, 10, { speed: 120, size: 2 });
      run.coins.splice(i, 1);
      continue;
    }

    if (magnetActive) {
      const dx = player.x - coin.x;
      const dy = player.y - coin.y;
      const distance = Math.hypot(dx, dy);
      if (distance < MAGNET_RADIUS && distance > 1) {
        // Coins accelerate as they get closer, like a real magnet.
        const pullSpeed = 250 + 650 * (1 - distance / MAGNET_RADIUS);
        const step = Math.min(distance, pullSpeed * dt);
        coin.x += (dx / distance) * step;
        coin.y += (dy / distance) * step;
      }
    }
  }
}

function updatePowerups(dt) {
  for (let i = run.powerups.length - 1; i >= 0; i--) {
    const powerup = run.powerups[i];
    powerup.age += dt;
    if (powerup.age >= POWERUP_CONFIG.lifetime) {
      spawnParticles(powerup.x, powerup.y, POWERUP_TYPES[powerup.type].color, 12, { speed: 120, size: 2 });
      run.powerups.splice(i, 1);
    }
  }
}


/* ==========================================================================
   11. COLLISIONS & DAMAGE
   ========================================================================== */

function handleCollisions() {
  const player = run.player;

  for (let i = run.coins.length - 1; i >= 0; i--) {
    if (circlesOverlap(player, run.coins[i])) collectCoin(i);
  }

  for (let i = run.powerups.length - 1; i >= 0; i--) {
    if (circlesOverlap(player, run.powerups[i])) collectPowerup(i);
  }

  for (let i = run.enemies.length - 1; i >= 0; i--) {
    if (!circlesOverlap(player, run.enemies[i])) continue;

    if (run.effects.shield > 0) {
      // The shield turns the player into a wrecking ball.
      destroyEnemy(i, true);
      run.screenShake = Math.max(run.screenShake, 6);
    } else if (isPlayerVulnerable()) {
      // After this hit the player is invulnerable, so any other enemies
      // touching them in the same moment cannot take a second life.
      damagePlayer(i);
      if (game.state !== "playing") return;
    }
  }
}

function collectCoin(index) {
  const coin = run.coins[index];
  run.coins.splice(index, 1);

  // Grabbing coins in quick succession builds a score multiplier.
  run.combo = run.comboTimer > 0 ? Math.min(run.combo + 1, COMBO_CONFIG.maxMultiplier) : 1;
  run.comboTimer = COMBO_CONFIG.window;

  const value = coin.isStar ? COIN_CONFIG.starValue : 1;
  const points = value * COIN_CONFIG.points * run.combo;
  run.coinsCollected += value;
  addScore(points);

  const color = coin.isStar ? "#ffe66b" : COLORS.coin;
  const shownPoints = Math.round(points * getDifficulty().scoreMultiplier);
  const comboText = run.combo > 1 ? `  x${run.combo}` : "";
  addFloatingText(coin.x, coin.y - 14, `+${shownPoints}${comboText}`, color, coin.isStar ? 26 : 20);
  spawnParticles(coin.x, coin.y, color, coin.isStar ? 30 : 16, { speed: coin.isStar ? 300 : 200, size: 3 });
  spawnRing(coin.x, coin.y, color, coin.isStar ? 70 : 40, 260, 2);

  restartAnimation(ui.scoreStat, "pop");
  restartAnimation(ui.coinsStat, "pop");
  if (coin.isStar) Sound.play("star");
  else Sound.play("coin", run.combo);
}

function collectPowerup(index) {
  const powerup = run.powerups[index];
  run.powerups.splice(index, 1);
  const type = POWERUP_TYPES[powerup.type];
  const player = run.player;

  if (type.duration > 0) {
    // Picking up a power-up that is already active refreshes its timer
    // instead of stacking, so effects stay predictable.
    const wasActive = run.effects[powerup.type] > 0;
    run.effects[powerup.type] = type.duration;
    showToast(`${type.label} ${wasActive ? "refreshed" : "activated"} · ${type.duration}s`, type.color);
  } else if (powerup.type === "nova") {
    spawnRing(player.x, player.y, type.color, NOVA_RADIUS, 1100, 6, true);
    spawnRing(player.x, player.y, "#ffffff", NOVA_RADIUS * 0.7, 800, 3);
    run.screenShake = Math.max(run.screenShake, 12);
    showToast("Nova Blast!", type.color);
    Sound.play("nova");
  } else if (powerup.type === "repair") {
    if (player.lives < PLAYER_CONFIG.maxLives) {
      player.lives += 1;
      showToast("Extra life restored", type.color);
    } else {
      addScore(SCORE_CONFIG.fullLifeBonus);
      showToast(`Full health bonus +${SCORE_CONFIG.fullLifeBonus}`, type.color);
    }
  }

  addFloatingText(player.x, player.y - 34, type.label.toUpperCase(), type.color, 22);
  spawnParticles(powerup.x, powerup.y, type.color, 24, { speed: 260, size: 3.5 });
  spawnRing(powerup.x, powerup.y, type.color, 90, 300, 3);
  if (powerup.type !== "nova") Sound.play("powerup");
}

function destroyEnemy(index, awardPoints) {
  const enemy = run.enemies[index];
  run.enemies.splice(index, 1);
  const color = ENEMY_TYPES[enemy.type].color;
  spawnParticles(enemy.x, enemy.y, color, 18, { speed: 280, size: 3.5 });
  spawnRing(enemy.x, enemy.y, color, enemy.radius * 3, 240, 2);

  if (awardPoints) {
    run.enemiesDestroyed += 1;
    addScore(SCORE_CONFIG.perEnemyDestroyed);
    const shownPoints = Math.round(SCORE_CONFIG.perEnemyDestroyed * getDifficulty().scoreMultiplier);
    addFloatingText(enemy.x, enemy.y - 12, `+${shownPoints}`, color, 16);
    Sound.play("kill");
  }
}

function damagePlayer(enemyIndex) {
  const player = run.player;
  player.lives -= 1;
  player.hurtTimer = PLAYER_CONFIG.hurtInvulnerability;
  run.combo = 0;
  run.comboTimer = 0;
  run.screenShake = 16;
  run.damageFlash = 1;

  // The enemy that hit you is destroyed (no points) and the others are
  // knocked back, so you aren't instantly swarmed again.
  destroyEnemy(enemyIndex, false);
  knockBackEnemies(player.x, player.y, 240, 480);
  spawnParticles(player.x, player.y, COLORS.danger, 30, { speed: 360, size: 4 });
  Sound.play("hurt");

  if (player.lives <= 0) {
    startDying();
    return;
  }
  addFloatingText(player.x, player.y - 34, player.lives === 1 ? "LAST LIFE!" : "-1 LIFE", COLORS.danger, 22);
}

function knockBackEnemies(x, y, radius, force) {
  for (const enemy of run.enemies) {
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > radius) continue;
    enemy.vx = (dx / distance) * force;
    enemy.vy = (dy / distance) * force;
    if (enemy.type === "dasher") {
      enemy.mode = "rest";
      enemy.modeTimer = 1;
    }
  }
}


/* ==========================================================================
   12. VISUAL EFFECTS
   ========================================================================== */

function spawnParticles(x, y, color, count, { speed = 220, size = 3, life = 0.6, angle = 0, spread = TAU, drag = 3 } = {}) {
  for (let i = 0; i < count; i++) {
    const direction = angle + (Math.random() - 0.5) * spread;
    const particleSpeed = speed * (0.35 + Math.random() * 0.65);
    const particleLife = life * (0.6 + Math.random() * 0.4);
    run.particles.push({
      x,
      y,
      vx: Math.cos(direction) * particleSpeed,
      vy: Math.sin(direction) * particleSpeed,
      life: particleLife,
      maxLife: particleLife,
      size: size * (0.6 + Math.random() * 0.8),
      color,
      drag,
    });
  }
  // Keep the particle count under control so the game always runs smoothly.
  if (run.particles.length > MAX_PARTICLES) run.particles.splice(0, run.particles.length - MAX_PARTICLES);
}

// An expanding circle. Nova rings also destroy enemies they pass over.
function spawnRing(x, y, color, maxRadius, speed, lineWidth = 2, destroysEnemies = false) {
  run.rings.push({ x, y, color, radius: 0, maxRadius, speed, lineWidth, destroysEnemies });
}

function addFloatingText(x, y, text, color, size = 20) {
  run.floatingTexts.push({ x, y, text, color, size, life: 1, maxLife: 1 });
}

function updateVisualEffects(dt) {
  for (let i = run.particles.length - 1; i >= 0; i--) {
    const particle = run.particles[i];
    particle.life -= dt;
    if (particle.life <= 0) {
      run.particles.splice(i, 1);
      continue;
    }
    const friction = Math.exp(-particle.drag * dt);
    particle.vx *= friction;
    particle.vy *= friction;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  for (let i = run.rings.length - 1; i >= 0; i--) {
    const ring = run.rings[i];
    ring.radius += ring.speed * dt;
    if (ring.destroysEnemies && game.state === "playing") {
      for (let j = run.enemies.length - 1; j >= 0; j--) {
        const enemy = run.enemies[j];
        if (distanceBetween(ring.x, ring.y, enemy.x, enemy.y) < ring.radius + enemy.radius) destroyEnemy(j, true);
      }
    }
    if (ring.radius >= ring.maxRadius) run.rings.splice(i, 1);
  }

  for (let i = run.floatingTexts.length - 1; i >= 0; i--) {
    const text = run.floatingTexts[i];
    text.life -= dt;
    text.y -= 42 * dt;
    if (text.life <= 0) run.floatingTexts.splice(i, 1);
  }

  run.screenShake = run.screenShake > 0.1 ? run.screenShake * Math.exp(-9 * dt) : 0;
  run.damageFlash = Math.max(0, run.damageFlash - dt * 1.8);
}

// The player's trail is recorded once per frame (not per physics step).
function recordTrail() {
  const player = run.player;
  const length = run.effects.speed > 0 || player.dashTimer > 0 ? PLAYER_CONFIG.trailLength * 1.6 : PLAYER_CONFIG.trailLength;
  player.trail.unshift({ x: player.x, y: player.y });
  while (player.trail.length > length) player.trail.pop();
}


/* ==========================================================================
   13. DRAWING
   Shape-drawing functions take the canvas context `g` as a parameter so the
   menu's field guide can reuse them to draw its icons.
   ========================================================================== */

// Neon glow. shadowBlur is measured in screen pixels, so it is scaled to match.
function setGlow(g, color, blur) {
  g.shadowColor = color;
  g.shadowBlur = blur * (g.glowScale || 1);
}

function clearGlow(g) {
  g.shadowBlur = 0;
}

// The arena's colour drifts from cyan toward red as the levels go up.
function getArenaHue() {
  return 190 + Math.min(run.level - 1, 9) * 17;
}

function traceStar(g, points, outerRadius, innerRadius) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (points * 2)) * TAU - Math.PI / 2;
    g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  g.closePath();
}

function tracePolygon(g, sides, radius) {
  g.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * TAU;
    g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  g.closePath();
}

function traceRoundedRect(g, x, y, width, height, radius) {
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + width, y, x + width, y + height, radius);
  g.arcTo(x + width, y + height, x, y + height, radius);
  g.arcTo(x, y + height, x, y, radius);
  g.arcTo(x, y, x + width, y, radius);
  g.closePath();
}

function drawCoinShape(g, x, y, radius, time, isStar) {
  g.save();
  g.translate(x, y);
  if (isStar) {
    const pulse = 1 + Math.sin(time * 6) * 0.08;
    g.rotate(time * 1.5);
    g.scale(pulse, pulse);
    setGlow(g, "#ffe66b", 24);
    g.fillStyle = "#ffe66b";
    traceStar(g, 5, radius, radius * 0.48);
    g.fill();
    clearGlow(g);
    g.fillStyle = "#fffbe0";
    traceStar(g, 5, radius * 0.5, radius * 0.24);
    g.fill();
  } else {
    // Squashing the coin horizontally makes it look like it's spinning.
    const spin = Math.abs(Math.cos(time * 3));
    g.scale(0.25 + spin * 0.75, 1);
    setGlow(g, COLORS.coin, 16);
    g.fillStyle = COLORS.coin;
    g.beginPath();
    g.arc(0, 0, radius, 0, TAU);
    g.fill();
    clearGlow(g);
    g.strokeStyle = "#b8860b";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, radius * 0.62, 0, TAU);
    g.stroke();
    g.fillStyle = "rgba(255, 255, 255, 0.75)";
    g.beginPath();
    g.arc(-radius * 0.35, -radius * 0.35, radius * 0.22, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Simple icons drawn inside each power-up badge.
function drawPowerupIcon(g, typeKey, size, color) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineJoin = "round";
  g.lineCap = "round";

  switch (typeKey) {
    case "shield":
      g.beginPath();
      g.moveTo(0, -size);
      g.lineTo(size * 0.85, -size * 0.6);
      g.lineTo(size * 0.7, size * 0.35);
      g.lineTo(0, size);
      g.lineTo(-size * 0.7, size * 0.35);
      g.lineTo(-size * 0.85, -size * 0.6);
      g.closePath();
      g.fill();
      break;

    case "speed": // lightning bolt
      g.beginPath();
      g.moveTo(size * 0.25, -size);
      g.lineTo(-size * 0.5, size * 0.12);
      g.lineTo(0, size * 0.12);
      g.lineTo(-size * 0.25, size);
      g.lineTo(size * 0.5, -size * 0.15);
      g.lineTo(0, -size * 0.15);
      g.closePath();
      g.fill();
      break;

    case "magnet": // horseshoe magnet with white tips
      g.lineWidth = size * 0.42;
      g.beginPath();
      g.moveTo(-size * 0.6, -size * 0.8);
      g.lineTo(-size * 0.6, 0);
      g.arc(0, 0, size * 0.6, Math.PI, 0, true);
      g.lineTo(size * 0.6, -size * 0.8);
      g.stroke();
      g.strokeStyle = "#ffffff";
      g.lineCap = "butt";
      g.beginPath();
      g.moveTo(-size * 0.6, -size * 0.9);
      g.lineTo(-size * 0.6, -size * 0.5);
      g.moveTo(size * 0.6, -size * 0.9);
      g.lineTo(size * 0.6, -size * 0.5);
      g.stroke();
      break;

    case "chrono": // hourglass
      g.beginPath();
      g.moveTo(-size * 0.65, -size * 0.9);
      g.lineTo(size * 0.65, -size * 0.9);
      g.lineTo(0, 0);
      g.closePath();
      g.moveTo(-size * 0.65, size * 0.9);
      g.lineTo(size * 0.65, size * 0.9);
      g.lineTo(0, 0);
      g.closePath();
      g.fill();
      break;

    case "nova": // burst
      traceStar(g, 8, size, size * 0.4);
      g.fill();
      break;

    case "repair": // heart
      g.beginPath();
      g.moveTo(0, size * 0.85);
      g.bezierCurveTo(-size * 1.15, size * 0.05, -size * 0.6, -size * 0.95, 0, -size * 0.35);
      g.bezierCurveTo(size * 0.6, -size * 0.95, size * 1.15, size * 0.05, 0, size * 0.85);
      g.fill();
      break;
  }
}

// Power-ups are rounded badges with a rotating dashed orbit, so they can't be
// mistaken for round coins or spiky enemies.
function drawPowerupShape(g, x, y, typeKey, time, alpha = 1) {
  const type = POWERUP_TYPES[typeKey];
  const r = POWERUP_CONFIG.radius;
  g.save();
  g.translate(x, y);
  g.globalAlpha = alpha;

  g.save();
  g.rotate(time * 1.2);
  g.globalAlpha = alpha * 0.6;
  g.strokeStyle = type.color;
  g.lineWidth = 2;
  g.setLineDash([6, 8]);
  g.beginPath();
  g.arc(0, 0, r + 8, 0, TAU);
  g.stroke();
  g.restore();

  setGlow(g, type.color, 18);
  g.fillStyle = "rgba(10, 12, 30, 0.92)";
  g.strokeStyle = type.color;
  g.lineWidth = 3;
  traceRoundedRect(g, -r, -r, r * 2, r * 2, 7);
  g.fill();
  g.stroke();
  clearGlow(g);
  drawPowerupIcon(g, typeKey, r * 0.6, type.color);
  g.restore();
}

function drawEnemyShape(g, enemy, time) {
  const type = ENEMY_TYPES[enemy.type];
  // Enemies "grow" into existence over their first quarter second.
  const appear = Math.min(1, enemy.age / 0.25);
  const r = enemy.radius * (0.3 + 0.7 * appear);
  const darkFill = "rgba(28, 4, 12, 0.92)";
  g.save();
  g.translate(enemy.x, enemy.y);
  setGlow(g, type.color, 16);
  g.strokeStyle = type.color;
  g.fillStyle = darkFill;

  switch (enemy.type) {
    case "chaser":
      g.rotate(time * 2 + enemy.seed);
      g.lineWidth = 2.5;
      traceStar(g, 8, r * 1.2, r * 0.78);
      g.fill();
      g.stroke();
      clearGlow(g);
      g.fillStyle = type.color;
      g.beginPath();
      g.arc(0, 0, r * 0.38, 0, TAU);
      g.fill();
      break;

    case "swarmer": {
      const heading = Math.atan2(enemy.vy, enemy.vx);
      g.rotate(enemy.vx === 0 && enemy.vy === 0 ? 0 : heading);
      g.fillStyle = type.color;
      g.beginPath();
      g.moveTo(r * 1.4, 0);
      g.lineTo(-r, r * 0.85);
      g.lineTo(-r * 0.45, 0);
      g.lineTo(-r, -r * 0.85);
      g.closePath();
      g.fill();
      break;
    }

    case "dasher": {
      g.rotate(Math.atan2(enemy.aimY, enemy.aimX));
      // Flash while winding up as a warning.
      const winding = enemy.mode === "windup";
      if (winding && Math.floor(time * 14) % 2 === 0) g.fillStyle = type.color;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(r * 1.5, 0);
      g.lineTo(0, r * 0.85);
      g.lineTo(-r, 0);
      g.lineTo(0, -r * 0.85);
      g.closePath();
      g.fill();
      g.stroke();
      clearGlow(g);
      g.fillStyle = winding ? "#ffffff" : type.color;
      g.beginPath();
      g.arc(r * 0.2, 0, r * 0.28, 0, TAU);
      g.fill();
      break;
    }

    case "brute":
      g.rotate(time * 0.4 + enemy.seed);
      g.lineWidth = 4;
      tracePolygon(g, 6, r);
      g.fill();
      g.stroke();
      clearGlow(g);
      g.lineWidth = 2;
      tracePolygon(g, 6, r * 0.55);
      g.stroke();
      g.fillStyle = type.color;
      g.beginPath();
      g.arc(0, 0, r * 0.22, 0, TAU);
      g.fill();
      break;
  }
  g.restore();
}

function drawArena(time) {
  const hue = getArenaHue();
  ctx.fillStyle = COLORS.arenaFloor;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  // The grid pulses faster as the level rises, building tension.
  const pulse = 0.5 + 0.5 * Math.sin(time * (1.2 + run.level * 0.35));
  ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.05 + pulse * 0.035})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_SIZE; x < WORLD_WIDTH; x += GRID_SIZE) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_HEIGHT);
  }
  for (let y = GRID_SIZE; y < WORLD_HEIGHT; y += GRID_SIZE) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_WIDTH, y);
  }
  ctx.stroke();

  // Glowing border.
  ctx.save();
  setGlow(ctx, `hsl(${hue}, 100%, 60%)`, 26);
  ctx.strokeStyle = `hsl(${hue}, 100%, 62%)`;
  ctx.lineWidth = 4;
  ctx.strokeRect(-2, -2, WORLD_WIDTH + 4, WORLD_HEIGHT + 4);
  ctx.restore();

  // Corner brackets for a sci-fi look.
  ctx.strokeStyle = `hsl(${hue}, 100%, 80%)`;
  ctx.lineWidth = 3;
  const corner = 34;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [WORLD_WIDTH, 0, -1, 1], [0, WORLD_HEIGHT, 1, -1], [WORLD_WIDTH, WORLD_HEIGHT, -1, -1]]) {
    ctx.moveTo(cx + sx * 6, cy + sy * (corner + 6));
    ctx.lineTo(cx + sx * 6, cy + sy * 6);
    ctx.lineTo(cx + sx * (corner + 6), cy + sy * 6);
  }
  ctx.stroke();
}

function drawSpawnWarnings(time) {
  for (const warning of run.spawnWarnings) {
    const type = ENEMY_TYPES[warning.type];
    const progress = 1 - warning.timer / ENEMY_SPAWN_CONFIG.warningTime;
    const radius = type.radius * 2.4 * (1 - progress * 0.55);
    const blink = Math.floor(time * 10) % 2 === 0 ? 1 : 0.55;
    ctx.save();
    ctx.translate(warning.x, warning.y);
    ctx.globalAlpha = (0.35 + progress * 0.65) * blink;
    ctx.strokeStyle = type.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.rotate(time * 3);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-time * 3);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(6, 6);
    ctx.moveTo(6, -6);
    ctx.lineTo(-6, 6);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCoins(time) {
  for (const coin of run.coins) {
    // Coins that are about to vanish blink during their last 2.5 seconds.
    const expiring = coin.lifetime !== null && coin.lifetime - coin.age < 2.5;
    if (expiring && Math.floor(time * 8) % 2 === 0) continue;
    const bob = Math.sin(time * 3 + coin.spinOffset) * 2;
    drawCoinShape(ctx, coin.x, coin.y + bob, coin.radius, time + coin.spinOffset, coin.isStar);
  }
}

function drawPowerups(time) {
  for (const powerup of run.powerups) {
    const timeLeft = POWERUP_CONFIG.lifetime - powerup.age;
    const alpha = timeLeft < 3 && Math.floor(time * 6) % 2 === 0 ? 0.35 : 1;
    const bob = Math.sin(time * 2.5 + powerup.x) * 3;
    drawPowerupShape(ctx, powerup.x, powerup.y + bob, powerup.type, time, alpha);
  }
}

function drawEnemies(time) {
  // Brute gravity fields and Dasher aim lines are drawn underneath the enemies.
  for (const enemy of run.enemies) {
    if (enemy.type === "brute") {
      const range = ENEMY_TYPES.brute.pullRange;
      ctx.save();
      ctx.strokeStyle = ENEMY_TYPES.brute.color;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        // Rings that shrink inward show the direction of the pull.
        const phase = (time * 0.5 + i * 0.5 + enemy.seed) % 1;
        ctx.globalAlpha = 0.22 * phase;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, range * (1 - phase) + enemy.radius, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = ENEMY_TYPES.brute.color;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, range, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (enemy.type === "dasher" && enemy.mode === "windup") {
      const progress = 1 - enemy.modeTimer / ENEMY_TYPES.dasher.windupTime;
      ctx.save();
      ctx.globalAlpha = 0.25 + progress * 0.6;
      ctx.strokeStyle = ENEMY_TYPES.dasher.color;
      ctx.lineWidth = 2 + progress * 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y);
      ctx.lineTo(enemy.x + enemy.aimX * 420, enemy.y + enemy.aimY * 420);
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const enemy of run.enemies) drawEnemyShape(ctx, enemy, time);
}

function drawPlayer(time) {
  const player = run.player;
  const speedActive = run.effects.speed > 0;
  const mainColor = speedActive ? POWERUP_TYPES.speed.color : COLORS.player;

  // Blink while invulnerable after a hit.
  const blinking = player.hurtTimer > 0 && Math.floor(player.hurtTimer * 12) % 2 === 0;
  const alpha = blinking ? 0.3 : 1;

  // Fading trail (additive blending makes overlapping circles glow).
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = player.trail.length - 1; i >= 1; i--) {
    const point = player.trail[i];
    const fade = 1 - i / player.trail.length;
    ctx.globalAlpha = fade * 0.3 * alpha;
    ctx.fillStyle = player.dashTimer > 0 ? "#ffffff" : mainColor;
    ctx.beginPath();
    ctx.arc(point.x, point.y, player.radius * (0.35 + fade * 0.6), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Magnet field.
  if (run.effects.magnet > 0) {
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(time * 6) * 0.08;
    ctx.strokeStyle = POWERUP_TYPES.magnet.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 12]);
    ctx.translate(player.x, player.y);
    ctx.rotate(-time * 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, MAGNET_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // The ball itself, stretched slightly in the direction it is moving.
  const speed = Math.hypot(player.vx, player.vy);
  const stretch = Math.min(0.35, speed / 2600);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(player.x, player.y);
  ctx.rotate(Math.atan2(player.vy, player.vx));
  ctx.scale(1 + stretch, 1 - stretch * 0.6);
  setGlow(ctx, mainColor, 28);
  const gradient = ctx.createRadialGradient(-4, -4, 1, 0, 0, player.radius);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.45, mainColor);
  gradient.addColorStop(1, speedActive ? "#0b7a3e" : "#0a6f86");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Shield bubble (flickers when about to expire).
  if (run.effects.shield > 0) {
    const expiring = run.effects.shield < 1.5 && Math.floor(time * 10) % 2 === 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(time * 1.5);
    ctx.globalAlpha = expiring ? 0.3 : 0.9;
    setGlow(ctx, POWERUP_TYPES.shield.color, 20);
    ctx.strokeStyle = POWERUP_TYPES.shield.color;
    ctx.lineWidth = 3;
    tracePolygon(ctx, 6, player.radius + 12);
    ctx.stroke();
    ctx.globalAlpha *= 0.15;
    ctx.fillStyle = POWERUP_TYPES.shield.color;
    ctx.fill();
    ctx.restore();
  }

  // Dash cooldown arc around the ball.
  if (player.dashCooldown > 0) {
    const ready = 1 - player.dashCooldown / PLAYER_CONFIG.dashCooldown;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#c7d3ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 6, -Math.PI / 2, -Math.PI / 2 + ready * TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRings() {
  ctx.save();
  for (const ring of run.rings) {
    ctx.globalAlpha = Math.max(0, 1 - ring.radius / ring.maxRadius);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = ring.lineWidth;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of run.particles) {
    ctx.globalAlpha = particle.life / particle.maxLife;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloatingTexts() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const text of run.floatingTexts) {
    ctx.globalAlpha = Math.min(1, (text.life / text.maxLife) * 1.6);
    ctx.font = `800 ${text.size}px "Segoe UI", sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(text.text, text.x, text.y);
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.restore();
}

// Full-screen effects drawn in screen space (not affected by the arena scale).
function drawScreenEffects(time) {
  const width = ui.canvas.width;
  const height = ui.canvas.height;
  const vignette = (color, strength) => {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, color.replace("ALPHA", strength.toFixed(3)));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  };

  if (run.effects.chrono > 0) vignette("rgba(150, 180, 255, ALPHA)", 0.28);
  if (game.state === "playing" && run.player.lives === 1) vignette("rgba(255, 30, 60, ALPHA)", 0.12 + Math.sin(time * 4) * 0.06);
  if (run.damageFlash > 0) vignette("rgba(255, 30, 60, ALPHA)", run.damageFlash * 0.7);
}

function render(time) {
  const width = ui.canvas.width;
  const height = ui.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  clearGlow(ctx);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Everything inside the arena is drawn in world coordinates.
  const shakeX = (Math.random() - 0.5) * 2 * run.screenShake;
  const shakeY = (Math.random() - 0.5) * 2 * run.screenShake;
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX + shakeX * view.scale, view.offsetY + shakeY * view.scale);

  drawArena(time);
  if (game.state !== "menu") {
    drawSpawnWarnings(time);
    drawCoins(time);
    drawPowerups(time);
    drawEnemies(time);
    const playerVisible = game.state === "countdown" || game.state === "playing" || game.state === "paused";
    if (playerVisible) drawPlayer(time);
    drawRings();
    drawParticles();
    drawFloatingTexts();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawScreenEffects(time);
}


/* ==========================================================================
   14. HUD
   The HUD is made of normal HTML elements. To keep things fast we only touch
   the page when a value actually changes.
   ========================================================================== */

const hudCache = {};

function setHudText(element, cacheKey, text) {
  if (hudCache[cacheKey] === text) return;
  hudCache[cacheKey] = text;
  element.textContent = text;
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function buildLivesDisplay() {
  ui.lives.innerHTML = "";
  for (let i = 0; i < PLAYER_CONFIG.maxLives; i++) {
    const life = document.createElement("span");
    life.className = "life";
    ui.lives.appendChild(life);
  }
}

// One chip per timed power-up, shown only while that power-up is active.
const powerupChips = {};

function buildPowerupChips() {
  for (const key of TIMED_POWERUPS) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.hidden = true;
    chip.style.setProperty("--accent", POWERUP_TYPES[key].color);
    chip.innerHTML = `
      <span class="chip-dot"></span>
      <span class="chip-label">${POWERUP_TYPES[key].label}</span>
      <span class="chip-time"></span>
      <span class="chip-bar"><span class="chip-fill"></span></span>`;
    ui.powerupChips.appendChild(chip);
    powerupChips[key] = {
      element: chip,
      time: chip.querySelector(".chip-time"),
      fill: chip.querySelector(".chip-fill"),
    };
  }
}

function updateLivesDisplay() {
  const lives = run.player.lives;
  const previous = hudCache.lives;
  if (previous === lives) return;
  hudCache.lives = lives;
  ui.lives.querySelectorAll(".life").forEach((life, index) => {
    const isLost = index >= lives;
    life.classList.toggle("lost", isLost);
    life.classList.remove("just-lost", "just-gained");
    if (previous !== undefined && isLost && index < previous) restartAnimation(life, "just-lost");
    if (previous !== undefined && !isLost && index >= previous) restartAnimation(life, "just-gained");
  });
}

function updateHud() {
  const player = run.player;
  setHudText(ui.score, "score", formatNumber(run.score));
  setHudText(ui.coins, "coins", String(run.coinsCollected));
  setHudText(ui.time, "time", formatTime(run.time));
  setHudText(ui.level, "level", String(run.level));
  if (hudCache.hue !== getArenaHue()) {
    hudCache.hue = getArenaHue();
    ui.level.style.setProperty("--accent", `hsl(${hudCache.hue}, 100%, 65%)`);
  }
  updateLivesDisplay();

  const dashReady = 1 - player.dashCooldown / PLAYER_CONFIG.dashCooldown;
  ui.dashFill.style.transform = `scaleX(${dashReady})`;
  ui.dashMeter.classList.toggle("ready", dashReady >= 1);

  const comboVisible = run.combo > 1 && run.comboTimer > 0;
  setHidden(ui.combo, !comboVisible);
  if (comboVisible) {
    setHudText(ui.comboValue, "combo", `x${run.combo}`);
    ui.comboFill.style.transform = `scaleX(${run.comboTimer / COMBO_CONFIG.window})`;
  }

  for (const key of TIMED_POWERUPS) {
    const chip = powerupChips[key];
    const remaining = run.effects[key];
    setHidden(chip.element, remaining <= 0);
    if (remaining <= 0) continue;
    setHudText(chip.time, `chip-${key}`, `${Math.ceil(remaining)}s`);
    chip.fill.style.transform = `scaleX(${remaining / POWERUP_TYPES[key].duration})`;
    chip.element.classList.toggle("expiring", remaining < 1.5);
  }
}

// Large banner for level-ups and arena events.
function announce(title, subtitle, color) {
  ui.announcementTitle.textContent = title;
  ui.announcementSubtitle.textContent = subtitle;
  ui.announcement.style.setProperty("--accent", color);
  restartAnimation(ui.announcement, "show");
}

// Small notification that removes itself when its CSS animation finishes.
function showToast(text, color) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  toast.style.setProperty("--accent", color);
  toast.addEventListener("animationend", () => toast.remove());
  ui.toasts.appendChild(toast);
  while (ui.toasts.children.length > 4) ui.toasts.firstElementChild.remove();
}

function clearMessages() {
  ui.toasts.innerHTML = "";
  ui.announcement.classList.remove("show");
  ui.countdown.classList.remove("show", "go");
}

function showCountdownText(text, isGo = false) {
  ui.countdown.textContent = text;
  ui.countdown.classList.toggle("go", isGo);
  restartAnimation(ui.countdown, "show");
}


/* ==========================================================================
   15. SCREENS & GAME FLOW
   ========================================================================== */

function showScreen(screen) {
  for (const overlay of [ui.startScreen, ui.pauseScreen, ui.gameOverScreen]) {
    overlay.classList.toggle("hidden", overlay !== screen);
  }
}

function startRun() {
  Sound.unlock();
  run = createRunState();
  for (let i = 0; i < COIN_CONFIG.startingCoins; i++) spawnCoin({ allowStar: false });
  clearMessages();
  showScreen(null);
  blurFocusedElement();
  run.countdown = 3;
  setState("countdown");
}

function updateCountdown(dt) {
  run.countdown -= dt;
  if (run.countdown <= 0) {
    setState("playing");
    showCountdownText("GO!", true);
    Sound.play("go");
    return;
  }
  const number = Math.ceil(run.countdown);
  if (number !== run.countdownShown) {
    run.countdownShown = number;
    showCountdownText(String(number));
    Sound.play("countdown");
  }
  updateVisualEffects(dt);
}

function pauseGame() {
  if (game.state !== "playing" && game.state !== "countdown") return;
  game.stateBeforePause = game.state;
  setState("paused");
  showScreen(ui.pauseScreen);
  Sound.play("click");
}

function resumeGame() {
  if (game.state !== "paused") return;
  setState(game.stateBeforePause || "playing");
  showScreen(null);
  blurFocusedElement();
  Sound.play("click");
}

function goToMainMenu() {
  run = createRunState();
  clearMessages();
  setState("menu");
  showScreen(ui.startScreen);
  refreshMenu();
}

// Called the moment the last life is lost: a short slow-motion explosion
// plays before the game-over screen appears.
function startDying() {
  const player = run.player;
  player.lives = 0;
  run.dyingTimer = 1.4;
  run.screenShake = 24;
  run.effects = Object.fromEntries(TIMED_POWERUPS.map((key) => [key, 0]));
  spawnParticles(player.x, player.y, COLORS.player, 70, { speed: 520, size: 4.5, life: 1.2, drag: 2 });
  spawnParticles(player.x, player.y, "#ffffff", 30, { speed: 300, size: 3, life: 0.9 });
  spawnRing(player.x, player.y, COLORS.player, 260, 500, 4);
  Sound.play("explode");
  setState("dying");
}

function updateDying(dt) {
  const slowMotion = dt * 0.35;
  updateEnemies(slowMotion);
  updateVisualEffects(slowMotion);
  run.dyingTimer -= dt;
  if (run.dyingTimer <= 0) endRun();
}

function endRun() {
  const finalScore = Math.floor(run.score);
  const record = game.records[game.difficultyKey];
  const isBestScore = finalScore > record.score;
  const isBestTime = run.time > record.time;
  const isBestCoins = run.coinsCollected > record.coins;

  record.score = Math.max(record.score, finalScore);
  record.time = Math.max(record.time, run.time);
  record.coins = Math.max(record.coins, run.coinsCollected);
  writeSavedJson(STORAGE_KEYS.records, game.records);

  ui.finalScore.textContent = formatNumber(finalScore);
  ui.finalCoins.textContent = String(run.coinsCollected);
  ui.finalTime.textContent = formatTime(run.time, true);
  ui.finalLevel.textContent = String(run.level);
  ui.finalKills.textContent = String(run.enemiesDestroyed);
  ui.bestScoreBadge.hidden = !isBestScore;
  ui.bestTimeBadge.hidden = !isBestTime;
  ui.bestCoinsBadge.hidden = !isBestCoins;
  ui.gameOverSubtitle.textContent = getGameOverMessage(run.time);

  setState("gameover");
  showScreen(ui.gameOverScreen);
  Sound.play("gameOver");
}

function getGameOverMessage(seconds) {
  if (seconds < 20) return "Short but sweet. Try dashing through gaps!";
  if (seconds < 60) return "Not bad — the arena was just warming up.";
  if (seconds < 120) return "Impressive reflexes. The neon remembers you.";
  return "Legendary survival. The arena bows to you.";
}

function selectDifficulty(key) {
  if (!Object.hasOwn(DIFFICULTIES, key)) return;
  game.difficultyKey = key;
  ui.difficultyButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === key));
  });
  saveSettings();
  refreshMenu();
}

function refreshMenu() {
  const difficulty = getDifficulty();
  const record = game.records[game.difficultyKey];
  ui.difficultyNote.textContent = difficulty.note;
  ui.bestLabel.textContent = difficulty.label;
  ui.bestScore.textContent = formatNumber(record.score);
  ui.bestTime.textContent = formatTime(record.time);
  ui.bestCoins.textContent = String(record.coins);
}

function toggleMute() {
  Sound.unlock();
  Sound.setMuted(!Sound.muted);
  updateMuteButtons();
  saveSettings();
}

function updateMuteButtons() {
  document.body.classList.toggle("muted", Sound.muted);
  ui.muteLabels.forEach((label) => {
    label.textContent = Sound.muted ? "Sound: off (M)" : "Sound: on (M)";
  });
}

// Builds the menu's field guide, drawing each icon with the real game code.
function buildFieldGuide() {
  const iconSize = 34;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  const addHeading = (text) => {
    const heading = document.createElement("div");
    heading.className = "guide-heading";
    heading.textContent = text;
    ui.fieldGuide.appendChild(heading);
  };

  const addRow = (name, description, color, extent, drawIcon) => {
    const row = document.createElement("div");
    row.className = "guide-row";
    row.style.setProperty("--accent", color);
    const canvas = document.createElement("canvas");
    canvas.className = "guide-icon";
    canvas.width = iconSize * pixelRatio;
    canvas.height = iconSize * pixelRatio;
    const text = document.createElement("div");
    text.className = "guide-text";
    text.innerHTML = `<strong>${name}</strong> — ${description}`;
    row.append(canvas, text);
    ui.fieldGuide.appendChild(row);

    // Scale the world-sized shape so it fits the small icon canvas.
    const g = canvas.getContext("2d");
    const scale = (iconSize * pixelRatio) / (extent * 2 + 6);
    g.glowScale = scale;
    g.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    drawIcon(g);
  };

  addHeading("Collect");
  addRow("Coin", `+${COIN_CONFIG.points} points, multiplied by your combo.`, COLORS.coin, COIN_CONFIG.radius + 4,
    (g) => drawCoinShape(g, 0, 0, COIN_CONFIG.radius, 0, false));
  addRow("Star Coin", `Rare! Worth ${COIN_CONFIG.starValue} coins, but vanishes quickly.`, "#ffe66b", COIN_CONFIG.starRadius + 3,
    (g) => drawCoinShape(g, 0, 0, COIN_CONFIG.starRadius, 0, true));

  addHeading("Power-ups");
  for (const [key, type] of Object.entries(POWERUP_TYPES)) {
    const label = type.duration > 0 ? `${type.label} (${type.duration}s)` : type.label;
    addRow(label, type.description, type.color, POWERUP_CONFIG.radius + 9,
      (g) => drawPowerupShape(g, 0, 0, key, 0.3));
  }

  addHeading("Enemies");
  for (const [key, type] of Object.entries(ENEMY_TYPES)) {
    const fakeEnemy = { ...createEnemy(key, 0, 0), age: 1, vx: 1, vy: -0.4, aimX: 1, aimY: -0.4 };
    const unlockText = type.unlockLevel > 1 ? ` <em>(Level ${type.unlockLevel}+)</em>` : "";
    addRow(type.name, type.description + unlockText, type.color, type.radius * 1.5,
      (g) => drawEnemyShape(g, fakeEnemy, 0.2));
  }
}

function bindUiEvents() {
  ui.playButton.addEventListener("click", startRun);
  ui.playAgainButton.addEventListener("click", startRun);
  ui.restartButton.addEventListener("click", startRun);
  ui.resumeButton.addEventListener("click", resumeGame);
  ui.pauseMenuButton.addEventListener("click", goToMainMenu);
  ui.gameOverMenuButton.addEventListener("click", goToMainMenu);
  ui.pauseButton.addEventListener("click", () => {
    if (game.state === "paused") resumeGame();
    else pauseGame();
  });
  ui.muteButtons.forEach((button) => button.addEventListener("click", toggleMute));
  ui.difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectDifficulty(button.dataset.difficulty);
      Sound.unlock();
      Sound.play("click");
    });
  });

  // After a mouse click, remove focus from the button so that pressing Space
  // (dash) or Enter later doesn't accidentally "click" it again.
  // (event.detail is 0 for keyboard-triggered clicks, which keep their focus.)
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button && event.detail > 0) button.blur();
  });
}


/* ==========================================================================
   16. MAIN LOOP & START-UP
   There is exactly ONE animation loop, started once when the page loads.
   It keeps running in every state; the current state decides what updates.
   Spawning uses timers stored in `run` (not setInterval), so pausing or
   restarting can never leave stray timers running in the background.
   ========================================================================== */

function update(dt) {
  switch (game.state) {
    case "countdown":
      updateCountdown(dt);
      break;
    case "playing": {
      // Split the frame into small physics steps (see MAX_PHYSICS_STEP).
      const steps = Math.ceil(dt / MAX_PHYSICS_STEP);
      const stepDt = dt / steps;
      for (let i = 0; i < steps && game.state === "playing"; i++) simulateStep(stepDt);
      recordTrail();
      break;
    }
    case "dying":
      updateDying(dt);
      break;
    case "paused":
      break; // the world is frozen
    default:
      updateVisualEffects(dt); // menu / game over: let leftover particles fade out
  }
}

let lastFrameTime = performance.now();

function gameLoop(now) {
  const dt = clamp((now - lastFrameTime) / 1000, 0, MAX_FRAME_TIME);
  lastFrameTime = now;
  update(dt);
  render(now / 1000);
  updateHud();
  requestAnimationFrame(gameLoop);
}

function init() {
  const settings = loadSettings();
  Sound.setMuted(settings.muted);

  buildLivesDisplay();
  buildPowerupChips();
  buildFieldGuide();
  bindUiEvents();
  bindInputEvents();

  resizeCanvas();
  // ResizeObserver catches every size change of the stage (window resizes,
  // HUD wrapping onto two lines, etc.). The window event catches zoom changes.
  new ResizeObserver(resizeCanvas).observe(ui.stage);
  window.addEventListener("resize", resizeCanvas);

  selectDifficulty(settings.difficulty);
  updateMuteButtons();
  setState("menu");
  showScreen(ui.startScreen);
  requestAnimationFrame(gameLoop);
}

init();
