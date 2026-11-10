# Neon Ball Survival

A neon arcade survival game that runs in the browser. You steer a glowing ball around an enclosed arena, collect coins, grab power-ups and dodge enemies that keep getting faster and more numerous. The aim is to survive as long as possible and set a high score.

It's built with plain **HTML, CSS and JavaScript**, and the game world is drawn on an **HTML Canvas**. There are no libraries, no build tools, no server and no internet connection needed. All graphics and sound effects are generated in code.

---

## How to run it (VS Code + Live Server + Chrome)

1. Open **Visual Studio Code**.
2. Choose **File → Open Folder…** and select the `NeonBallSurvival` folder.
3. If you don't have it yet, install the **Live Server** extension (by Ritwick Dey): open the Extensions panel (`Ctrl+Shift+X`), search for *Live Server* and click **Install**.
4. In the Explorer panel, right-click **`index.html`** and choose **"Open with Live Server"**.
5. The game opens in your default browser at an address like `http://127.0.0.1:5500/index.html`.

**Making sure it opens in Chrome:** if your default browser isn't Chrome, either copy the address into Chrome, or tell Live Server to use Chrome. Open VS Code settings (`Ctrl+,`), search for `liveServer.settings.CustomBrowser` and choose `chrome`.

**Without Live Server:** you can also just double-click `index.html` and it will run directly from the file. Live Server is still recommended, because it reloads the page automatically whenever you save a change.

---

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` **or** arrow keys | Move (both work, and can be mixed) |
| `Space` or `Shift` | Dash: a quick burst of speed with brief invulnerability (2 s cooldown) |
| `Esc` or `P` | Pause / resume |
| `M` | Mute / unmute sound |
| `Enter` | Start a run from the menu, or play again after game over |

The game also pauses automatically if you switch tabs or click outside the window.

---

## How to play

- You start with **3 lives** (the glowing orbs in the top-right corner).
- **Touching an enemy costs one life.** You then flash for 1.6 seconds and can't be hurt again during that time. The enemy that hit you is destroyed and nearby enemies are knocked back, so you never lose several lives at once.
- **Collect coins** for points. Grab them quickly one after another to build a **combo** (up to ×5) that multiplies their value.
- **Survive** to earn points over time. Every 25 seconds the **level** goes up: enemies spawn more often, move faster and new enemy types appear.
- When your last life is gone, the run ends and the game-over screen shows your results.

### Score

| Source | Points |
| --- | --- |
| Coin | 100 × combo |
| Star Coin (rare) | 500 × combo (counts as 5 coins) |
| Each second survived | 10 |
| Enemy destroyed (by Shield or Nova) | 75 |

All points are multiplied by the difficulty: Easy ×0.75, Normal ×1, Hard ×1.5.

---

## Features

### Core features (from the specification)
- Smooth, slightly weighted movement with WASD **and** arrow keys. Diagonal movement is normalised, so it's no faster than straight movement.
- Wall bouncing that never gets stuck or clips through the walls (see *Design decisions*).
- Randomly spawning coins (never outside the arena or on top of the player), with a limit on how many exist at once, respawning over time, and a coin counter.
- Enemies that chase the player smoothly and stay inside the arena.
- 3 lives, shown as icons, with damage cooldown and clear damage feedback.
- Timed power-ups with visible indicators, activation and expiry messages, and safe timers.
- A Speed Boost that can't stack.
- Difficulty that increases gradually, with caps so it never becomes impossible.
- A game-over screen with final score, coins and survival time, and a restart that needs no page refresh.
- Survival timer and score.

### Enemy types
| Enemy | Appears from | Behaviour |
| --- | --- | --- |
| **Chaser** (red spiky star) | Level 1 | Steers smoothly toward you. |
| **Dasher** (orange diamond) | Level 2 | Approaches, stops and aims (a dashed line shows where it will go), then charges in a straight line. |
| **Swarmer** (pink arrow) | Level 3 | Small and fast. Arrives in packs of three and weaves from side to side. |
| **Brute** (crimson hexagon) | Level 5 | Big and slow, but its gravity field pulls you toward it. A dash always breaks free. |

### Power-ups
| Power-up | Effect |
| --- | --- |
| **Shield** (purple, 6 s) | You can't be hurt, and enemies you touch are destroyed. |
| **Speed Boost** (green, 6 s) | Move 60 % faster. |
| **Coin Magnet** (blue, 8 s) | Coins within a large radius fly toward you. |
| **Chrono** (white, 5 s) | All enemies move at 40 % speed. |
| **Nova Blast** (magenta, instant) | A shockwave that destroys every enemy nearby. |
| **Extra Life** (pink heart, instant) | Restores one life. It only appears when you've lost a life. |

### Extra features I added
1. **Start menu** with difficulty selection (Easy / Normal / Hard), a controls list and an illustrated **field guide**. The guide's icons are drawn with the same code as the game itself.
2. **Dash ability** with a cooldown, brief invulnerability and a cooldown ring around the ball.
3. **Combo system**: chain coins within 2.2 seconds for up to ×5 points. The coin sound rises in pitch as the combo grows.
4. **Star Coins**: rare coins worth 5 that disappear after 9 seconds.
5. **Coin Rush** arena event every 60 seconds: 10 bonus coins appear and vanish after 10 seconds.
6. **Four enemy types** with distinct behaviours, plus **spawn warnings**. A flashing marker shows where an enemy will appear 0.9 s beforehand, so spawns never feel cheap.
7. **Three extra power-ups**: Chrono, Nova Blast and Extra Life.
8. **3-2-1-GO countdown** before each run, and a **pause menu** (Resume / Restart / Main menu).
9. **Best records** (score, time and coins) saved per difficulty in the browser, with "New best!" badges.
10. **Game feel**: particles, expanding rings, floating score text, screen shake, a red damage flash, a pulsing warning on your last life, squash-and-stretch on the ball, a movement trail and a slow-motion death explosion.
11. **Rising intensity**: the arena's colour shifts from cyan toward red and the background grid pulses faster as the level rises. Level-up banners announce new enemy types.
12. **Synthesised sound effects** using the Web Audio API (no audio files), with a mute button and the `M` key. The mute setting is remembered.

---

## Project structure

```
NeonBallSurvival/
├── index.html         Page structure: HUD, canvas, menus, pause and game-over screens
├── style.css          All visual styling for the HUD, menus, buttons and animations
├── script.js          All game logic and canvas drawing
├── README.md          This file
└── SPECIFICATION.txt  The original project specification
```

There are no other files. Everything you see in the arena is drawn with Canvas, and every sound is generated in code.

### A guided tour of `script.js`

The file is split into 16 numbered sections. Search for the headings to jump between them:

| # | Section | What it does |
| --- | --- | --- |
| 1 | Configuration | **Every tunable number**: speeds, durations, spawn rates, colours, enemy and power-up definitions. Start here if you want to tweak the game. |
| 2 | Page elements | Looks up the HTML elements the script needs. |
| 3 | Helper functions | Small maths and formatting helpers. |
| 4 | Saved data | Loads and saves best scores and settings in `localStorage`, safely. |
| 5 | Sound | A tiny synthesiser that creates the sound effects. |
| 6 | Keyboard input | Tracks which keys are held, plus shortcuts like pause and dash. |
| 7 | Canvas sizing | Fits the fixed 1280×720 arena into any window without stretching it. |
| 8 | Game state | `game` (settings, records, current screen) and `run` (everything about the current attempt). |
| 9 | Spawning | Where and when coins, power-ups and enemies appear. |
| 10 | Updating the world | Player movement, enemy behaviours, pickups, power-up timers and difficulty. |
| 11 | Collisions & damage | Collecting things, taking damage and destroying enemies. |
| 12 | Visual effects | Particles, rings and floating text. |
| 13 | Drawing | Draws every shape on the canvas. |
| 14 | HUD | Updates the score, lives, timers and power-up chips. |
| 15 | Screens & game flow | Menu, countdown, pause, game over and restart. |
| 16 | Main loop & start-up | The single animation loop and `init()`. |

### Ideas for experimenting
- Change `PLAYER_CONFIG.speed` or `PLAYER_CONFIG.dashCooldown` to change how the player feels.
- Edit `getLevelStats()` to make the difficulty curve gentler or harsher.
- Add a new enemy: add an entry to `ENEMY_TYPES`, a movement function to `ENEMY_BEHAVIOURS` and a drawing `case` in `drawEnemyShape()`.
- Add a new power-up: add an entry to `POWERUP_TYPES`, handle it in `collectPowerup()` and draw an icon in `drawPowerupIcon()`.

---

## Design decisions

- **Bouncing vs. containment:** the player **bounces** off walls, keeping 55 % of their speed, because it feels lively and dashing into walls becomes a fun ricochet. Only the part of the velocity pointing *into* the wall is reversed, so you keep sliding along the wall in the direction you're steering. Very soft hits just stop instead of bouncing, which removes the jitter you'd otherwise get while holding a key against a wall.
- **Fixed-size world:** the arena is always 1280×720 "world units" and is scaled uniformly to fit the window. Resizing the window never stretches anything or changes the gameplay, and the game state is untouched.
- **Small physics steps:** each frame is split into steps of at most 1/120 s, so even a fast dash can't skip through an enemy or a wall.
- **One loop, no `setInterval`:** there is exactly one `requestAnimationFrame` loop, started once. All spawn timers are plain numbers stored in the `run` object and counted down by the loop. Pausing therefore freezes them, and restarting replaces the whole `run` object. No duplicate loops or leftover timers can exist.
- **Power-ups refresh, they don't stack:** collecting a power-up that's already active resets its timer to the full duration. Speed Boost is simply "on" (×1.6) or "off", so multipliers can never pile up. The dash uses its own fixed speed, so it behaves the same with or without the boost.
- **Fair damage:** after a hit you get 1.6 s of invulnerability, the enemy that hit you is removed and nearby enemies are pushed away. Enemies also appear only after a visible warning, at least 320 px away from you.
- **Difficulty curve:** each level (every 25 s) shortens the spawn interval by 12 %, raises enemy speed by 6 % and allows two more enemies on screen. These are capped at a 0.9 s spawn interval, ×1.55 speed and 22 enemies.
- **Auto-pause:** if the window loses focus, held keys are forgotten (preventing "stuck" movement) and the game pauses.

---

## Testing checklist

To test the game yourself, open it with Live Server, press `F12` to open Chrome DevTools, select the **Console** tab, and then:

1. **Movement:** move with WASD, then with the arrow keys. Both should work.
2. **Diagonal speed:** hold `D`, then hold `D`+`S`. The ball should move at the same speed both ways.
3. **Walls:** hold a direction into a wall, and dash into walls. The ball bounces once, then rests against the wall. It never leaves the arena or gets stuck.
4. **Coins:** collect coins. The score and coin counter go up, with a sparkle and a floating number.
5. **Enemies:** wait a couple of seconds. A red marker appears, then a Chaser that follows you.
6. **Damage cooldown:** get hit. You lose exactly one life and flash for a moment, during which enemies can't hurt you.
7. **Lives:** the HUD shows three orbs at the start.
8. **Power-ups:** collect power-ups. A chip with a countdown appears in the HUD, and a message appears when the power-up expires.
9. **Difficulty:** after 25 seconds a "Level 2" banner appears, and enemies gradually become faster and more frequent.
10. **Game over:** lose all lives. A short slow-motion explosion plays, then the game-over screen shows your score, coins and time.
11. **Restart:** click **Play again**. Everything resets and the countdown starts. Do this several times; the game should not speed up.
12. **Pause:** press `Esc` or `P`. Everything freezes. Press it again to continue.
13. **Resize:** resize the browser window during play. The arena rescales without stretching and the game carries on.
14. **Console:** the Console should show no red errors.

### What has been tested
The game was tested in headless Google Chrome with an automated script that drives the real game code. It ran **66 checks**, and all of them passed. They covered every item above except the visual ones, plus a 6-minute "soak test" of chaotic play on Hard. That test reached level 15 with all enemy and power-up types, and checked that there were no invalid positions, broken timers or uncaught errors. Screenshots of the menu and of gameplay at several window sizes were also checked.

Testing by an actual human player still matters, though. How the game *feels* (difficulty balance, sound volume, controls) can only be judged by playing it.

---

## Known limitations

- **Keyboard only.** There are no touch or gamepad controls, so it's designed for desktop and laptop browsers.
- **Best scores are stored per browser.** They live in that browser's `localStorage` and don't sync between computers. Clearing site data resets them.
- **Sound starts after your first click or key press.** This is a browser rule. If audio isn't available, the game simply plays silently.
- **Very old or low-power computers** may find the glow effects demanding. If the game stutters, lowering the `setGlow` blur values in `script.js` will help.
- The "Segoe UI" font is used where available (it's standard on Windows). Other systems fall back to a similar system font.
