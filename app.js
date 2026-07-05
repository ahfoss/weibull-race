// --- MATHEMATICAL HELPERS ---

/**
 * Lanczos Gamma function approximation.
 * Highly accurate for real numbers z > 0.
 */
function gamma(z) {
    const g = 7;
    const p = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    let x = p[0];
    for (let i = 1; i < g + 2; i++) {
        x += p[i] / (z + i);
    }
    let t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * Computes the theoretical mean of a Weibull distribution
 * Mean = lambda * Gamma(1 + 1/k)
 */
function theoreticalWeibullMean(k, lambda) {
    return lambda * gamma(1 + 1 / k);
}

/**
 * Computes the theoretical standard deviation of a Weibull distribution
 * StdDev = lambda * sqrt( Gamma(1 + 2/k) - (Gamma(1 + 1/k))^2 )
 */
function theoreticalWeibullStd(k, lambda) {
    const g1 = gamma(1 + 1 / k);
    const g2 = gamma(1 + 2 / k);
    const variance = lambda * lambda * (g2 - g1 * g1);
    return Math.sqrt(Math.max(0, variance));
}

/**
 * Generates a Weibull-distributed random variable using inverse transform sampling
 * X = lambda * (-ln(U))^(1/k)
 */
function sampleWeibull(k, lambda) {
    const u = Math.random();
    // Clamp u to avoid log(0)
    const clampedU = Math.max(u, 1e-15);
    return lambda * Math.pow(-Math.log(clampedU), 1 / k);
}

// --- STATE MANAGEMENT ---

const state = {
    // Configs
    k: 0.7,      // Shape parameter (default: Clustered)
    lambda: 1.6, // Scale parameter (seconds) (default: Clustered)
    preset: 'clustered',
    aiStrategy: 'random',
    travelTime: 6.25, // Seconds a line takes to traverse the screen
    tolerance: 0.35, // Match window in seconds (350ms)

    // Game Control
    isPlaying: false,
    currentView: 'setup', // 'setup' or 'game'
    nextSpawnTime: 0,
    lastTime: 0,
    gameTime: 0,
    canDismissVictory: true, // Safety flag to prevent accidental victory skips
    winner: null, // 'human' or 'ai'

    // Charges Cooldown System (max 5)
    maxCharges: 5,
    humanCharges: 5,
    aiCharges: 5,
    chargeRegenRate: 1.2, // Seconds to regenerate 1 charge

    // Statistics
    bestTime: localStorage.getItem('weibull_best_time') ? parseFloat(localStorage.getItem('weibull_best_time')) : null,
    
    humanHits: 0,
    humanMisses: 0,
    humanStreak: 0,
    humanPredictionsCount: 0,
    
    aiHits: 0,
    aiMisses: 0,
    aiStreak: 0,
    aiPredictionsCount: 0,

    // Entities (Shared lines, separate predictions)
    lines: [],
    humanPredictions: [],
    aiPredictions: [],
    particles: [],
    floatingTexts: [],

    // Visuals / Cooldowns
    shakeIntensity: 0,
    shakeDuration: 0,
    humanLastPressTime: 0,
    aiLastPressTime: 0,
    spaceDebounce: 50, // Minimum ms between inputs

    // AI strategy state variables
    aiLastLineSeenId: null, // Keeps track of the last processed line ID
    aiIntervalTimer: 0, // Targets fire timestamp for Interval strategy
    aiPendingFires: 0, // Counter of predictions pending to fire
    aiBurstTimeouts: [], // Handles delayed burst predictions
    
    // Audio Settings
    audioCtx: null,
    isMuted: false
};

// --- DOM ELEMENTS ---

const setupView = document.querySelector('.setup-view');
const gameView = document.querySelector('.game-view');
const setupStartBtn = document.getElementById('setupStartBtn');
const backToSetupBtn = document.getElementById('backToSetupBtn');

const hudHumanHits = document.getElementById('hudHumanHits');
const hudAiHits = document.getElementById('hudAiHits');
const hudTimeVal = document.getElementById('hudTimeVal');

const presetClustered = document.getElementById('presetClustered');
const presetMemoryless = document.getElementById('presetMemoryless');
const presetFrailty = document.getElementById('presetFrailty');

const stratRandom = document.getElementById('stratRandom');
const stratInterval = document.getElementById('stratInterval');
const stratBursty = document.getElementById('stratBursty');

const pdfCanvas = document.getElementById('pdfCanvas');
const pdfCtx = pdfCanvas.getContext('2d');
const theoreticalMeanEl = document.getElementById('theoreticalMean');
const theoreticalStdEl = document.getElementById('theoreticalStd');

const humanSuccessVal = document.getElementById('humanSuccessVal');
const aiSuccessVal = document.getElementById('aiSuccessVal');
const humanStreakVal = document.getElementById('humanStreakVal');
const aiStreakVal = document.getElementById('aiStreakVal');

const timeVal = document.getElementById('timeVal');
const bestTimeVal = document.getElementById('bestTimeVal');

const playBtn = document.getElementById('playBtn');
const playBtnText = document.getElementById('playBtnText');
const audioBtn = document.getElementById('audioBtn');
const audioIcon = document.getElementById('audioIcon');
const audioBtnText = document.getElementById('audioBtnText');
const resetBtn = document.getElementById('resetBtn');
const startPrompt = document.getElementById('startPrompt');
const promptPlayBtn = document.getElementById('promptPlayBtn');

const gameCanvas = document.getElementById('gameCanvas');
const gameCtx = gameCanvas.getContext('2d');

// --- SYNTHESIZED SOUND EFFECTS ---

function initAudio() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (state.isMuted) return;
    initAudio();
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    const ctx = state.audioCtx;
    const now = ctx.currentTime;

    if (type === 'click') {
        // Spacebar input click feedback
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);

        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        osc.start(now);
        osc.stop(now + 0.08);
    } else if (type === 'success') {
        // High quality futuristic success chord
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 (C Major)
        const duration = 0.5;

        notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + index * 0.03); // Slight arpeggio

            // Volume envelope
            gainNode.gain.setValueAtTime(0.0, now);
            gainNode.gain.linearRampToValueAtTime(0.08, now + index * 0.03 + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.start(now + index * 0.03);
            osc.stop(now + duration + 0.1);
        });
    } else if (type === 'failure') {
        // Deep error buzz sound
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.25);

        // Lowpass filter to soften the sawtooth
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, now);
        
        osc.disconnect(gainNode);
        osc.connect(filter);
        filter.connect(gainNode);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.start(now);
        osc.stop(now + 0.26);
    }
}

// --- PARTICLE & VISUAL EFFECTS ---

function triggerScreenShake(intensity, duration) {
    state.shakeIntensity = intensity;
    state.shakeDuration = duration;
}

function spawnSuccessParticles(x, y) {
    const colorPalette = ['#00e676', '#00f2fe', '#ffffff'];
    const particleCount = 25;
    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3.5;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed - 1.0, // Drift slightly left with the track speed
            vy: Math.sin(angle) * speed,
            radius: 2 + Math.random() * 3,
            color: colorPalette[Math.floor(Math.random() * colorPalette.length)],
            alpha: 1.0,
            decay: 0.02 + Math.random() * 0.03
        });
    }
}

function spawnFloatingText(text, x, y, color, scale = 1.0) {
    state.floatingTexts.push({
        text: text,
        x: x,
        y: y,
        vy: -0.8 - Math.random() * 0.8,
        alpha: 1.0,
        color: color,
        scale: scale,
        life: 1.0,
        decay: 0.015
    });
}

// --- UPDATE & RENDERING LOGIC ---

function drawPDF() {
    const width = pdfCanvas.width;
    const height = pdfCanvas.height;
    pdfCtx.clearRect(0, 0, width, height);

    const k = state.k;
    const lambda = state.lambda;

    // Calculate dynamic range for graphing: up to 3.5 * scale parameter (lambda)
    const maxTime = Math.max(10, lambda * 3.0);
    
    // Evaluate Standard Weibull PDF function
    const pdf = (x) => {
        if (x <= 0) return 0;
        return (k / lambda) * Math.pow(x / lambda, k - 1) * Math.exp(-Math.pow(x / lambda, k));
    };

    // Find maximum PDF value to scale the height of the graph dynamically
    let maxVal = 0.1;
    const steps = 150;
    for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * maxTime;
        maxVal = Math.max(maxVal, pdf(x));
    }

    // Add extra padding to maximum height
    maxVal *= 1.15;

    // Draw background grid lines
    pdfCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    pdfCtx.lineWidth = 1;
    const gridCount = 5;
    for (let i = 1; i < gridCount; i++) {
        const x = (i / gridCount) * width;
        pdfCtx.beginPath();
        pdfCtx.moveTo(x, 0);
        pdfCtx.lineTo(x, height);
        pdfCtx.stroke();
    }

    // Create gradient fill for the PDF shape
    const areaGradient = pdfCtx.createLinearGradient(0, height, 0, 10);
    areaGradient.addColorStop(0, 'rgba(0, 242, 254, 0.02)');
    areaGradient.addColorStop(1, 'rgba(0, 242, 254, 0.25)');

    // Begin drawing PDF outline and area
    pdfCtx.beginPath();
    pdfCtx.moveTo(0, height);

    for (let i = 0; i <= steps; i++) {
        const timeVal = (i / steps) * maxTime;
        const density = pdf(timeVal);
        const drawX = (timeVal / maxTime) * width;
        const drawY = height - (density / maxVal) * (height - 15);
        pdfCtx.lineTo(drawX, drawY);
    }
    
    pdfCtx.lineTo(width, height);
    pdfCtx.closePath();
    pdfCtx.fillStyle = areaGradient;
    pdfCtx.fill();

    // Draw PDF boundary line
    pdfCtx.strokeStyle = '#00f2fe';
    pdfCtx.lineWidth = 2;
    pdfCtx.shadowColor = 'rgba(0, 242, 254, 0.5)';
    pdfCtx.shadowBlur = 4;
    pdfCtx.beginPath();
    
    for (let i = 0; i <= steps; i++) {
        const timeVal = (i / steps) * maxTime;
        const density = pdf(timeVal);
        const drawX = (timeVal / maxTime) * width;
        const drawY = height - (density / maxVal) * (height - 15);
        if (i === 0) pdfCtx.moveTo(drawX, drawY);
        else pdfCtx.lineTo(drawX, drawY);
    }
    pdfCtx.stroke();
    pdfCtx.shadowBlur = 0; // Reset shadow

    // Calculate & draw theoretical mean line
    const meanVal = theoreticalWeibullMean(k, lambda);
    const meanX = (meanVal / maxTime) * width;
    if (meanX >= 0 && meanX <= width) {
        pdfCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        pdfCtx.lineWidth = 1;
        pdfCtx.setLineDash([3, 3]);
        pdfCtx.beginPath();
        pdfCtx.moveTo(meanX, 0);
        pdfCtx.lineTo(meanX, height);
        pdfCtx.stroke();
        pdfCtx.setLineDash([]);

        // Mean label
        pdfCtx.fillStyle = varColor('--text-muted');
        pdfCtx.font = '9px Outfit';
        pdfCtx.fillText('Mean (μ)', meanX + 4, 12);
    }

    // Render timeline scales along the bottom axis
    pdfCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    pdfCtx.font = '8px JetBrains Mono';
    pdfCtx.fillText('0s', 2, height - 4);
    
    const midTimeLabel = (maxTime / 2).toFixed(1) + 's';
    pdfCtx.fillText(midTimeLabel, width / 2 - 10, height - 4);
    
    const maxTimeLabel = maxTime.toFixed(1) + 's';
    pdfCtx.fillText(maxTimeLabel, width - 30, height - 4);

    // Update theoretical numerical displays in UI
    const stdVal = theoreticalWeibullStd(k, lambda);
    theoreticalMeanEl.textContent = meanVal.toFixed(2) + 's';
    theoreticalStdEl.textContent = stdVal.toFixed(2) + 's';
}

// Read CSS variables programmatically
function varColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function handleResize() {
    const rect = gameCanvas.parentNode.getBoundingClientRect();
    gameCanvas.width = rect.width;
    gameCanvas.height = rect.height;
}

// Add actual line spawn (shared targets on both tracks)
function spawnLine(time) {
    state.lines.push({
        id: Math.random().toString(36).substr(2, 9),
        spawnTime: time,
        humanMatched: false,
        aiMatched: false
    });
}

// Add prediction on spacebar press for Human
function makeHumanPrediction(time) {
    if (time - state.humanLastPressTime < state.spaceDebounce) return;
    
    // Check if we have at least 1 charge
    if (state.humanCharges < 1.0) {
        return; // Ignore spacebar if out of charges
    }

    state.humanLastPressTime = time;
    state.humanCharges -= 1.0;

    playSound('click');
    state.humanPredictionsCount++;

    const newPred = {
        id: Math.random().toString(36).substr(2, 9),
        pressTime: time,
        matched: false,
        status: 'pending', // pending, hit, miss
        accuracy: 0
    };
    state.humanPredictions.push(newPred);
}

// Add prediction automatically for AI
function makeAIPrediction(time) {
    if (time - state.aiLastPressTime < state.spaceDebounce) return;
    
    // Check if we have at least 1 charge
    if (state.aiCharges < 1.0) {
        return; // Ignore if out of charges
    }

    state.aiLastPressTime = time;
    state.aiCharges -= 1.0;

    state.aiPredictionsCount++;

    const newPred = {
        id: Math.random().toString(36).substr(2, 9),
        pressTime: time,
        matched: false,
        status: 'pending', // pending, hit, miss
        accuracy: 0
    };
    state.aiPredictions.push(newPred);
}

// Evaluate newly spawned line against Human pending predictions
function evaluateLineSpawnHuman(line) {
    let closestPred = null;
    let minDiff = Infinity;

    state.humanPredictions.forEach(pred => {
        if (pred.status === 'pending') {
            const diff = (line.spawnTime - pred.pressTime) / 1000;
            if (diff >= 0 && diff <= state.tolerance && diff < minDiff) {
                minDiff = diff;
                closestPred = pred;
            }
        }
    });

    if (closestPred) {
        line.humanMatched = true;
        closestPred.matched = true;
        closestPred.status = 'hit';
        closestPred.accuracy = 1 - (minDiff / state.tolerance);

        processHumanHit(closestPred, minDiff);
    }
}

// Evaluate newly spawned line against AI pending predictions
function evaluateLineSpawnAI(line) {
    let closestPred = null;
    let minDiff = Infinity;

    state.aiPredictions.forEach(pred => {
        if (pred.status === 'pending') {
            const diff = (line.spawnTime - pred.pressTime) / 1000;
            if (diff >= 0 && diff <= state.tolerance && diff < minDiff) {
                minDiff = diff;
                closestPred = pred;
            }
        }
    });

    if (closestPred) {
        line.aiMatched = true;
        closestPred.matched = true;
        closestPred.status = 'hit';
        closestPred.accuracy = 1 - (minDiff / state.tolerance);

        processAIHit(closestPred, minDiff);
    }
}

// AI Simulator Tick
function updateAI(elapsed) {
    if (!state.isPlaying) return;

    const latestLine = state.lines[state.lines.length - 1];

    if (state.aiStrategy === 'random') {
        // Prevent idle charges at maximum
        if (state.aiCharges >= 4.8) {
            makeAIPrediction(state.gameTime);
        } else {
            // Otherwise fire with moderate probability (approx once every 1.5s)
            if (Math.random() < 0.015) {
                makeAIPrediction(state.gameTime);
            }
        }
    } else if (state.aiStrategy === 'interval') {
        // Observe new spawned lines
        if (latestLine && latestLine.id !== state.aiLastLineSeenId) {
            state.aiLastLineSeenId = latestLine.id;
            const meanVal = theoreticalWeibullMean(state.k, state.lambda);
            state.aiIntervalTimer = latestLine.spawnTime + meanVal * 1000;
            state.aiPendingFires = 0;
        }

        // Check if timer fired
        if (state.aiIntervalTimer > 0 && state.gameTime >= state.aiIntervalTimer) {
            state.aiPendingFires = Math.floor(state.aiCharges);
            state.aiIntervalTimer = 0;
        }

        // Fire charges sequentially
        if (state.aiPendingFires > 0 && state.aiCharges >= 1.0) {
            if (state.gameTime - state.aiLastPressTime >= state.spaceDebounce) {
                makeAIPrediction(state.gameTime);
                state.aiPendingFires--;
            }
        }
    } else if (state.aiStrategy === 'bursty') {
        // Observe new spawned lines
        if (latestLine && latestLine.id !== state.aiLastLineSeenId) {
            state.aiLastLineSeenId = latestLine.id;
            
            // Clear previous burst timeouts
            state.aiBurstTimeouts = [];

            // Schedule tight burst predictions (3 predictions)
            const delays = [30, 150, 300];
            delays.forEach(delay => {
                state.aiBurstTimeouts.push({
                    triggerTime: state.gameTime + delay,
                    fired: false
                });
            });
        }

        // Process scheduled burst predictions
        state.aiBurstTimeouts.forEach(bt => {
            if (!bt.fired && state.gameTime >= bt.triggerTime) {
                if (state.aiCharges >= 1.0) {
                    makeAIPrediction(state.gameTime);
                }
                bt.fired = true;
            }
        });
        state.aiBurstTimeouts = state.aiBurstTimeouts.filter(bt => !bt.fired);
    }
}

function processHumanHit(pred, diff) {
    state.humanHits++;
    state.humanStreak++;

    playSound('success');
    triggerScreenShake(3, 10);
    
    // Spawn effects
    const scoreX = gameCanvas.width - 40;
    const scoreY = gameCanvas.height / 4 + 10; // human track center
    
    let floatColor = '#00f2fe'; // cyan
    let label = `HIT! ${state.humanHits}/10`;
    if (diff < 0.05) {
        label = `PERFECT! ${state.humanHits}/10`;
        floatColor = '#00e676'; // green
        triggerScreenShake(6, 15);
    }
    
    spawnFloatingText(label, scoreX - 30, scoreY, floatColor, 1.2);
    spawnSuccessParticles(scoreX - 20, scoreY);
    updateStatsUI();

    if (state.humanHits >= 10) {
        triggerDuelEnd('human');
    }
}

function processHumanMiss(pred) {
    pred.status = 'miss';
    state.humanMisses++;
    state.humanStreak = 0;
    
    playSound('failure');
    triggerScreenShake(5, 15);
    
    const speed = gameCanvas.width / (state.travelTime * 1000);
    const scoreX = gameCanvas.width - 40 - (state.gameTime - pred.pressTime) * speed;
    const scoreY = gameCanvas.height / 4 + 10 + 40; // human track center + offset
    
    spawnFloatingText('MISS', scoreX, scoreY, '#ff1744', 1.0);
    updateStatsUI();
}

function processAIHit(pred, diff) {
    state.aiHits++;
    state.aiStreak++;

    // AI hits do not shake screen or play audio to keep player feedback clear
    
    // Spawn effects
    const scoreX = gameCanvas.width - 40;
    const scoreY = 3 * gameCanvas.height / 4 - 10; // AI track center
    
    let floatColor = '#ff9100'; // AI orange
    let label = `AI HIT! ${state.aiHits}/10`;
    if (diff < 0.05) {
        label = `AI PERFECT! ${state.aiHits}/10`;
        floatColor = '#ff3d00'; // red-orange
    }
    
    spawnFloatingText(label, scoreX - 30, scoreY, floatColor, 1.1);
    spawnSuccessParticles(scoreX - 20, scoreY);
    updateStatsUI();

    if (state.aiHits >= 10) {
        triggerDuelEnd('ai');
    }
}

function processAIMiss(pred) {
    pred.status = 'miss';
    state.aiMisses++;
    state.aiStreak = 0;
    
    const speed = gameCanvas.width / (state.travelTime * 1000);
    const scoreX = gameCanvas.width - 40 - (state.gameTime - pred.pressTime) * speed;
    const scoreY = 3 * gameCanvas.height / 4 - 10 + 40; // AI track center + offset
    
    spawnFloatingText('AI MISS', scoreX, scoreY, '#ff1744', 0.9);
    updateStatsUI();
}

function updateStatsUI() {
    const timeString = (state.gameTime / 1000).toFixed(2) + 's';
    timeVal.textContent = timeString;
    humanSuccessVal.textContent = `${state.humanHits}/10`;
    aiSuccessVal.textContent = `${state.aiHits}/10`;
    humanStreakVal.textContent = state.humanStreak;
    aiStreakVal.textContent = state.aiStreak;
    bestTimeVal.textContent = state.bestTime ? state.bestTime.toFixed(2) + 's' : '-';

    // Mirror to mobile HUD
    if (hudTimeVal) hudTimeVal.textContent = timeString;
    if (hudHumanHits) hudHumanHits.textContent = `${state.humanHits}/10`;
    if (hudAiHits) hudAiHits.textContent = `${state.aiHits}/10`;
}

function resetStats() {
    state.humanHits = 0;
    state.humanMisses = 0;
    state.humanStreak = 0;
    state.humanPredictionsCount = 0;

    state.aiHits = 0;
    state.aiMisses = 0;
    state.aiStreak = 0;
    state.aiPredictionsCount = 0;

    state.gameTime = 0;
    state.humanCharges = state.maxCharges;
    state.aiCharges = state.maxCharges;
    state.lines = [];
    state.humanPredictions = [];
    state.aiPredictions = [];
    state.particles = [];
    state.floatingTexts = [];
    state.humanLastPressTime = 0;
    state.aiLastPressTime = 0;

    state.aiLastLineSeenId = null;
    state.aiIntervalTimer = 0;
    state.aiPendingFires = 0;
    state.aiBurstTimeouts = [];

    state.winner = null;
    
    // Reset best time in stats and storage
    state.bestTime = null;
    localStorage.removeItem('weibull_best_time');
    
    updateStatsUI();
}

function triggerDuelEnd(winner) {
    state.isPlaying = false;
    state.canDismissVictory = false; // Lock interactions

    // Toggle play button to show play icon again
    playBtn.classList.remove('btn-secondary');
    playBtn.classList.add('btn-primary');
    playBtnText.textContent = 'Play Again';
    
    const playIcon = playBtn.querySelector('svg');
    if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';

    const finalTime = state.gameTime / 1000;
    let isNewRecord = false;
    
    if (winner === 'human') {
        playVictorySound();
        if (state.bestTime === null || finalTime < state.bestTime) {
            state.bestTime = finalTime;
            localStorage.setItem('weibull_best_time', finalTime);
            isNewRecord = true;
        }
    } else {
        // Play failure arpeggio sound
        if (!state.isMuted) {
            initAudio();
            const ctx = state.audioCtx;
            const now = ctx.currentTime;
            const failureNotes = [293.66, 277.18, 261.63, 220.00]; // D4, C#4, C4, A3
            failureNotes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gainNode = ctx.createGain();
                osc.connect(gainNode);
                gainNode.connect(ctx.destination);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, now + idx * 0.15);
                gainNode.gain.setValueAtTime(0, now + idx * 0.15);
                gainNode.gain.linearRampToValueAtTime(0.05, now + idx * 0.15 + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.4);
                osc.start(now + idx * 0.15);
                osc.stop(now + idx * 0.15 + 0.5);
            });
        }
    }

    // Determine recommended strategy depending on current parameter preset
    let recommendedStrat = '';
    let explanationText = '';
    if (state.preset === 'clustered') {
        recommendedStrat = 'Bursty';
        explanationText = 'With shape parameter <strong>k = 0.7 &lt; 1</strong>, the Weibull distribution is bursty/clustered. Once a line is observed, the probability of another line spawning immediately after is high. The <strong>Bursty</strong> strategy capitalizes on this clustering by firing charges in a tight sequence right after a spawn.';
    } else if (state.preset === 'memoryless') {
        recommendedStrat = 'Interval / Random';
        explanationText = 'With shape parameter <strong>k = 1.0</strong>, the distribution is memoryless (exponential). Spawns are completely independent of the past, meaning past line spawns provide zero predictive value. The <strong>Interval</strong> strategy matches the average rate, but theoretically no strategy has a deterministic advantage.';
    } else {
        // frailty
        recommendedStrat = 'Interval';
        explanationText = 'With shape parameter <strong>k = 5.0 &gt; 1</strong>, the distribution is in its wear-out phase. The standard deviation is extremely narrow, making arrivals highly regular. Lines spawn almost exactly at the mean interval (\(\mu \approx 2.0s\)). The <strong>Interval</strong> strategy is highly suited here because it waits exactly this mean duration to fire.';
    }
    
    // Update victory overlay prompt
    const promptTitle = startPrompt.querySelector('h3');
    const promptText = startPrompt.querySelector('p');
    const promptIcon = startPrompt.querySelector('.prompt-icon');
    const promptPlayBtn = document.getElementById('promptPlayBtn');
    
    if (winner === 'human') {
        promptIcon.textContent = 'VICTORY';
        promptIcon.style.color = '#00e676';
        promptIcon.style.borderColor = '#00e676';
        promptTitle.textContent = 'You Won!';
        promptText.innerHTML = `
            You reached 10 hits first in <strong class="mono" style="color: #00f2fe; font-size: 1.2em;">${finalTime.toFixed(2)}s</strong>!<br>
            ${isNewRecord ? '<span style="color: #00e676; font-weight: 800;">★ NEW BEST RECORD! ★</span><br>' : ''}
            AI Opponent Strategy: <strong>${state.aiStrategy.toUpperCase()}</strong> (Hits: ${state.aiHits}/10)<br><br>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; text-align: left; font-size: 0.9em; line-height: 1.4;">
                <span style="color: #00f2fe; font-weight: 700;">Recommended Strategy: ${recommendedStrat}</span><br>
                ${explanationText}
            </div>
        `;
    } else {
        promptIcon.textContent = 'DEFEAT';
        promptIcon.style.color = '#ff1744';
        promptIcon.style.borderColor = '#ff1744';
        promptTitle.textContent = 'AI Won!';
        promptText.innerHTML = `
            The AI beat you to 10 hits in <strong class="mono" style="color: #ff9100; font-size: 1.2em;">${finalTime.toFixed(2)}s</strong>!<br>
            Your Hits: ${state.humanHits}/10 | AI Opponent Strategy: <strong>${state.aiStrategy.toUpperCase()}</strong><br><br>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; text-align: left; font-size: 0.9em; line-height: 1.4;">
                <span style="color: #ff9100; font-weight: 700;">Recommended Strategy: ${recommendedStrat}</span><br>
                ${explanationText}
            </div>
        `;
    }
    
    // 3-second button cooldown block
    let timeLeft = 3;
    promptPlayBtn.disabled = true;
    promptPlayBtn.textContent = `Play Again (${timeLeft}s)`;
    
    const cdInterval = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft > 0) {
            promptPlayBtn.textContent = `Play Again (${timeLeft}s)`;
        } else {
            clearInterval(cdInterval);
            promptPlayBtn.disabled = false;
            promptPlayBtn.textContent = 'Play Again';
            state.canDismissVictory = true; // Unlock interactions
        }
    }, 1000);

    // Show overlay
    startPrompt.classList.remove('hidden');
    updateStatsUI();
}

function playVictorySound() {
    if (state.isMuted) return;
    initAudio();
    const ctx = state.audioCtx;
    const now = ctx.currentTime;
    
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        
        gainNode.gain.setValueAtTime(0, now + idx * 0.12);
        gainNode.gain.linearRampToValueAtTime(0.08, now + idx * 0.12 + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4);
        
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.5);
    });
}

// --- GAME LOOP ---

function gameLoop(timestamp) {
    if (!state.lastTime) state.lastTime = timestamp;
    const elapsed = timestamp - state.lastTime;
    state.lastTime = timestamp;

    if (state.isPlaying) {
        state.gameTime += elapsed;
        
        // Handle interarrival spawning timers
        if (state.gameTime >= state.nextSpawnTime) {
            const actualSpawn = state.nextSpawnTime; // Anchored time for mathematical accuracy
            spawnLine(actualSpawn);
            
            const latestLine = state.lines[state.lines.length - 1];
            evaluateLineSpawnHuman(latestLine);
            evaluateLineSpawnAI(latestLine);

            // Setup next arrival
            const nextInterval = sampleWeibull(state.k, state.lambda) * 1000;
            state.nextSpawnTime = actualSpawn + nextInterval;

            // Safety check in case of immense lag: jump ahead
            if (state.gameTime > state.nextSpawnTime) {
                state.nextSpawnTime = state.gameTime + nextInterval;
            }
        }

        updateAI(elapsed);
        updatePhysics(elapsed);
        renderGame();
        
        // Update live speedrun timer
        timeVal.textContent = (state.gameTime / 1000).toFixed(2) + 's';
    }

    requestAnimationFrame(gameLoop);
}

function updatePhysics(elapsed) {
    const W = gameCanvas.width;
    const speed = W / (state.travelTime * 1000); // pixels per millisecond

    // Regenerate prediction charges
    if (state.isPlaying) {
        state.humanCharges = Math.min(state.maxCharges, state.humanCharges + (elapsed / 1000) / state.chargeRegenRate);
        state.aiCharges = Math.min(state.maxCharges, state.aiCharges + (elapsed / 1000) / state.chargeRegenRate);
    }

    // Update lines position
    state.lines.forEach(line => {
        line.x = W - (state.gameTime - line.spawnTime) * speed;
    });

    // Remove off-screen lines
    state.lines = state.lines.filter(line => line.x > -10);

    // Update Human predictions position
    state.humanPredictions.forEach(pred => {
        pred.x = W - (state.gameTime - pred.pressTime) * speed;

        // Check if pending prediction times out and transitions to miss
        if (pred.status === 'pending' && (state.gameTime - pred.pressTime) / 1000 > state.tolerance) {
            processHumanMiss(pred);
        }
    });
    state.humanPredictions = state.humanPredictions.filter(pred => pred.x > -10);

    // Update AI predictions position
    state.aiPredictions.forEach(pred => {
        pred.x = W - (state.gameTime - pred.pressTime) * speed;

        // Check if pending prediction times out and transitions to miss
        if (pred.status === 'pending' && (state.gameTime - pred.pressTime) / 1000 > state.tolerance) {
            processAIMiss(pred);
        }
    });
    state.aiPredictions = state.aiPredictions.filter(pred => pred.x > -10);

    // Update particles
    state.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
    });
    state.particles = state.particles.filter(p => p.alpha > 0);

    // Update floating text
    state.floatingTexts.forEach(ft => {
        ft.y += ft.vy;
        ft.life -= ft.decay;
        ft.alpha = Math.max(0, ft.life);
    });
    state.floatingTexts = state.floatingTexts.filter(ft => ft.alpha > 0);

    // Handle screen shake decay
    if (state.shakeDuration > 0) {
        state.shakeDuration--;
    } else {
        state.shakeIntensity = 0;
    }
}

function renderGame() {
    const W = gameCanvas.width;
    const H = gameCanvas.height;

    gameCtx.save();

    // Screen shake implementation
    if (state.shakeIntensity > 0 && state.shakeDuration > 0) {
        const shakeX = (Math.random() - 0.5) * state.shakeIntensity;
        const shakeY = (Math.random() - 0.5) * state.shakeIntensity;
        gameCtx.translate(shakeX, shakeY);
    }

    // Clear and draw background gradient
    gameCtx.fillStyle = '#08090c';
    gameCtx.fillRect(0, 0, W, H);

    const grad = gameCtx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W);
    grad.addColorStop(0, '#121422');
    grad.addColorStop(1, '#08090c');
    gameCtx.fillStyle = grad;
    gameCtx.fillRect(0, 0, W, H);

    // Draw background grid lines (drifting slowly left)
    const speed = W / (state.travelTime * 1000);
    const spacing = 150; // distance between lines in pixels
    const offset = (state.gameTime * speed) % spacing;
    gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    gameCtx.lineWidth = 1;
    for (let x = W - offset; x > -20; x -= spacing) {
        gameCtx.beginPath();
        gameCtx.moveTo(x, 0);
        gameCtx.lineTo(x, H);
        gameCtx.stroke();
    }

    // Split canvas height into two tracks
    const trackH = 140; // Track height
    const track1Y = H / 4 + 10;   // Human track center
    const track2Y = 3 * H / 4 - 10; // AI track center

    // Render Track dividers
    gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    gameCtx.lineWidth = 2;
    gameCtx.setLineDash([8, 8]);
    gameCtx.beginPath();
    gameCtx.moveTo(0, H / 2);
    gameCtx.lineTo(W, H / 2);
    gameCtx.stroke();
    gameCtx.setLineDash([]);

    // DRAW HUMAN TRACK (TOP)
    gameCtx.fillStyle = 'rgba(0, 242, 254, 0.008)';
    gameCtx.fillRect(0, track1Y - trackH / 2, W, trackH);
    gameCtx.strokeStyle = 'rgba(0, 242, 254, 0.06)';
    gameCtx.lineWidth = 1;
    gameCtx.strokeRect(0, track1Y - trackH / 2, W, trackH);

    // Draw track label
    gameCtx.fillStyle = 'rgba(0, 242, 254, 0.4)';
    gameCtx.font = 'bold 11px Outfit';
    gameCtx.fillText('HUMAN TRACK', 20, track1Y - trackH / 2 + 20);

    // DRAW AI TRACK (BOTTOM)
    gameCtx.fillStyle = 'rgba(255, 145, 0, 0.008)';
    gameCtx.fillRect(0, track2Y - trackH / 2, W, trackH);
    gameCtx.strokeStyle = 'rgba(255, 145, 0, 0.06)';
    gameCtx.lineWidth = 1;
    gameCtx.strokeRect(0, track2Y - trackH / 2, W, trackH);

    // Draw track label
    gameCtx.fillStyle = 'rgba(255, 145, 0, 0.4)';
    gameCtx.font = 'bold 11px Outfit';
    gameCtx.fillText(`AI TRACK [${state.aiStrategy.toUpperCase()}]`, 20, track2Y - trackH / 2 + 20);

    // Draw prediction zone highlight (right edge)
    const toleranceWidth = state.tolerance * 1000 * speed;
    
    // Human Zone
    const humanZoneGrad = gameCtx.createLinearGradient(W - toleranceWidth - 20, 0, W - 20, 0);
    humanZoneGrad.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
    humanZoneGrad.addColorStop(1, 'rgba(0, 242, 254, 0.06)');
    gameCtx.fillStyle = humanZoneGrad;
    gameCtx.fillRect(W - toleranceWidth - 20, track1Y - trackH / 2, toleranceWidth, trackH);

    // AI Zone
    const aiZoneGrad = gameCtx.createLinearGradient(W - toleranceWidth - 20, 0, W - 20, 0);
    aiZoneGrad.addColorStop(0, 'rgba(255, 145, 0, 0.0)');
    aiZoneGrad.addColorStop(1, 'rgba(255, 145, 0, 0.06)');
    gameCtx.fillStyle = aiZoneGrad;
    gameCtx.fillRect(W - toleranceWidth - 20, track2Y - trackH / 2, toleranceWidth, trackH);

    // Spawn Portal Target Line at the right edge
    const portalX = W - 20;

    // Human Portal
    gameCtx.save();
    gameCtx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    gameCtx.lineWidth = 2;
    gameCtx.shadowColor = '#00f2fe';
    gameCtx.shadowBlur = 8;
    gameCtx.beginPath();
    gameCtx.moveTo(portalX, track1Y - trackH / 2 + 5);
    gameCtx.lineTo(portalX, track1Y + trackH / 2 - 5);
    gameCtx.stroke();
    gameCtx.restore();

    // AI Portal
    gameCtx.save();
    gameCtx.strokeStyle = 'rgba(255, 145, 0, 0.4)';
    gameCtx.lineWidth = 2;
    gameCtx.shadowColor = '#ff9100';
    gameCtx.shadowBlur = 8;
    gameCtx.beginPath();
    gameCtx.moveTo(portalX, track2Y - trackH / 2 + 5);
    gameCtx.lineTo(portalX, track2Y + trackH / 2 - 5);
    gameCtx.stroke();
    gameCtx.restore();

    // Draw actual lines (shared spawns)
    state.lines.forEach(line => {
        if (line.x < -5 || line.x > W + 5) return;

        // Human line segment
        gameCtx.save();
        if (line.humanMatched) {
            gameCtx.strokeStyle = 'rgba(0, 230, 118, 0.4)';
            gameCtx.shadowColor = '#00e676';
            gameCtx.shadowBlur = 10;
        } else {
            gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            gameCtx.shadowColor = '#ffffff';
            gameCtx.shadowBlur = 5;
        }
        gameCtx.lineWidth = 4;
        gameCtx.beginPath();
        gameCtx.moveTo(line.x - 20, track1Y - trackH / 2 + 10);
        gameCtx.lineTo(line.x - 20, track1Y + trackH / 2 - 10);
        gameCtx.stroke();
        gameCtx.restore();

        // AI line segment
        gameCtx.save();
        if (line.aiMatched) {
            gameCtx.strokeStyle = 'rgba(0, 230, 118, 0.4)';
            gameCtx.shadowColor = '#00e676';
            gameCtx.shadowBlur = 10;
        } else {
            gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            gameCtx.shadowColor = '#ffffff';
            gameCtx.shadowBlur = 5;
        }
        gameCtx.lineWidth = 4;
        gameCtx.beginPath();
        gameCtx.moveTo(line.x - 20, track2Y - trackH / 2 + 10);
        gameCtx.lineTo(line.x - 20, track2Y + trackH / 2 - 10);
        gameCtx.stroke();
        gameCtx.restore();
    });

    const predW = 16;
    const predH = 40;
    const visualShift = 12;

    // Draw human predictions (top track)
    state.humanPredictions.forEach(pred => {
        if (pred.x < -5 || pred.x > W + 5) return;

        const drawX = pred.x - predW / 2 + visualShift - 20;
        const drawY = track1Y - predH / 2;

        gameCtx.save();
        let fillColor = 'rgba(255, 255, 255, 0.15)';
        let strokeColor = 'rgba(255, 255, 255, 0.3)';
        let glowColor = 'transparent';
        let glowPower = 0;

        if (pred.status === 'hit') {
            fillColor = 'rgba(0, 230, 118, 0.2)';
            strokeColor = '#00e676';
            glowColor = '#00e676';
            glowPower = 12;
        } else if (pred.status === 'miss') {
            fillColor = 'rgba(255, 23, 68, 0.2)';
            strokeColor = '#ff1744';
            glowColor = '#ff1744';
            glowPower = 12;
        } else {
            fillColor = 'rgba(0, 242, 254, 0.2)';
            strokeColor = '#00f2fe';
            glowColor = '#00f2fe';
            glowPower = 6;
        }

        gameCtx.fillStyle = fillColor;
        gameCtx.strokeStyle = strokeColor;
        gameCtx.lineWidth = 2;
        if (glowPower > 0) {
            gameCtx.shadowColor = glowColor;
            gameCtx.shadowBlur = glowPower;
        }

        drawRoundedRect(gameCtx, drawX, drawY, predW, predH, 4);
        gameCtx.fill();
        gameCtx.stroke();
        gameCtx.restore();

        if (pred.status === 'hit' && pred.accuracy > 0.8) {
            gameCtx.fillStyle = '#ffffff';
            gameCtx.font = 'bold 9px JetBrains Mono';
            gameCtx.textAlign = 'center';
            gameCtx.fillText('★', pred.x + visualShift - 20, drawY - 6);
        }
    });

    // Draw AI predictions (bottom track)
    state.aiPredictions.forEach(pred => {
        if (pred.x < -5 || pred.x > W + 5) return;

        const drawX = pred.x - predW / 2 + visualShift - 20;
        const drawY = track2Y - predH / 2;

        gameCtx.save();
        let fillColor = 'rgba(255, 255, 255, 0.15)';
        let strokeColor = 'rgba(255, 255, 255, 0.3)';
        let glowColor = 'transparent';
        let glowPower = 0;

        if (pred.status === 'hit') {
            fillColor = 'rgba(0, 230, 118, 0.2)';
            strokeColor = '#00e676';
            glowColor = '#00e676';
            glowPower = 12;
        } else if (pred.status === 'miss') {
            fillColor = 'rgba(255, 23, 68, 0.2)';
            strokeColor = '#ff1744';
            glowColor = '#ff1744';
            glowPower = 12;
        } else {
            fillColor = 'rgba(255, 145, 0, 0.2)';
            strokeColor = '#ff9100';
            glowColor = '#ff9100';
            glowPower = 6;
        }

        gameCtx.fillStyle = fillColor;
        gameCtx.strokeStyle = strokeColor;
        gameCtx.lineWidth = 2;
        if (glowPower > 0) {
            gameCtx.shadowColor = glowColor;
            gameCtx.shadowBlur = glowPower;
        }

        drawRoundedRect(gameCtx, drawX, drawY, predW, predH, 4);
        gameCtx.fill();
        gameCtx.stroke();
        gameCtx.restore();

        if (pred.status === 'hit' && pred.accuracy > 0.8) {
            gameCtx.fillStyle = '#ffffff';
            gameCtx.font = 'bold 9px JetBrains Mono';
            gameCtx.textAlign = 'center';
            gameCtx.fillText('★', pred.x + visualShift - 20, drawY - 6);
        }
    });

    // Draw particle bursts
    state.particles.forEach(p => {
        gameCtx.fillStyle = p.color;
        gameCtx.globalAlpha = p.alpha;
        gameCtx.beginPath();
        gameCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        gameCtx.fill();
    });
    gameCtx.globalAlpha = 1.0;

    // Draw floating points/text
    state.floatingTexts.forEach(ft => {
        gameCtx.fillStyle = ft.color;
        gameCtx.globalAlpha = ft.alpha;
        gameCtx.font = `bold ${Math.round(14 * ft.scale)}px Outfit`;
        gameCtx.textAlign = 'center';
        
        gameCtx.shadowColor = ft.color;
        gameCtx.shadowBlur = 6;
        gameCtx.fillText(ft.text, ft.x, ft.y);
        gameCtx.shadowBlur = 0;
    });
    gameCtx.globalAlpha = 1.0;

    // Draw prediction charges indicators
    const maxC = state.maxCharges;
    const barW = 22;
    const barH = 5;
    const gap = 4;
    const chargesX = W - (maxC * (barW + gap)) - 35;

    // 1. Human charges (top track right)
    gameCtx.save();
    gameCtx.fillStyle = 'rgba(0, 242, 254, 0.4)';
    gameCtx.font = '9px JetBrains Mono';
    gameCtx.textAlign = 'right';
    gameCtx.fillText('CHARGES', W - 35, track1Y - trackH / 2 + 18);
    for (let i = 0; i < maxC; i++) {
        const x = chargesX + i * (barW + gap);
        const y = track1Y - trackH / 2 + 24;
        gameCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        gameCtx.lineWidth = 1;
        drawRoundedRect(gameCtx, x, y, barW, barH, 1.5);
        gameCtx.fill();
        gameCtx.stroke();

        const fillLevel = Math.max(0, Math.min(1, state.humanCharges - i));
        if (fillLevel > 0) {
            gameCtx.fillStyle = fillLevel === 1 ? 'rgba(0, 242, 254, 0.8)' : 'rgba(0, 242, 254, 0.3)';
            if (fillLevel === 1) {
                gameCtx.shadowColor = '#00f2fe';
                gameCtx.shadowBlur = 4;
            }
            drawRoundedRect(gameCtx, x, y, barW * fillLevel, barH, 1.5);
            gameCtx.fill();
            gameCtx.shadowBlur = 0;
        }
    }
    gameCtx.restore();

    // 2. AI charges (bottom track right)
    gameCtx.save();
    gameCtx.fillStyle = 'rgba(255, 145, 0, 0.4)';
    gameCtx.font = '9px JetBrains Mono';
    gameCtx.textAlign = 'right';
    gameCtx.fillText('CHARGES', W - 35, track2Y - trackH / 2 + 18);
    for (let i = 0; i < maxC; i++) {
        const x = chargesX + i * (barW + gap);
        const y = track2Y - trackH / 2 + 24;
        gameCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        gameCtx.lineWidth = 1;
        drawRoundedRect(gameCtx, x, y, barW, barH, 1.5);
        gameCtx.fill();
        gameCtx.stroke();

        const fillLevel = Math.max(0, Math.min(1, state.aiCharges - i));
        if (fillLevel > 0) {
            gameCtx.fillStyle = fillLevel === 1 ? 'rgba(255, 145, 0, 0.8)' : 'rgba(255, 145, 0, 0.3)';
            if (fillLevel === 1) {
                gameCtx.shadowColor = '#ff9100';
                gameCtx.shadowBlur = 4;
            }
            drawRoundedRect(gameCtx, x, y, barW * fillLevel, barH, 1.5);
            gameCtx.fill();
            gameCtx.shadowBlur = 0;
        }
    }
    gameCtx.restore();

    // DRAW SUCCESS FUEL BARS ON THE FAR RIGHT
    const fuelBarWidth = 5;
    const fuelBarHeight = trackH - 30;
    const fuelBarX = W - 14;

    // 1. Human Fuel Bar
    const fuel1Y = track1Y - fuelBarHeight / 2 + 10;
    gameCtx.save();
    gameCtx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    gameCtx.lineWidth = 1;
    drawRoundedRect(gameCtx, fuelBarX, fuel1Y, fuelBarWidth, fuelBarHeight, 2.5);
    gameCtx.fill();
    gameCtx.stroke();

    for (let i = 1; i < 10; i++) {
        const tickY = fuel1Y + fuelBarHeight - (i / 10) * fuelBarHeight;
        gameCtx.beginPath();
        gameCtx.moveTo(fuelBarX, tickY);
        gameCtx.lineTo(fuelBarX + fuelBarWidth, tickY);
        gameCtx.stroke();
    }

    const humanFillPct = Math.min(1.0, state.humanHits / 10);
    if (humanFillPct > 0) {
        const fillHeight = fuelBarHeight * humanFillPct;
        const fillY = fuel1Y + fuelBarHeight - fillHeight;
        const fuelGrad = gameCtx.createLinearGradient(0, fuel1Y + fuelBarHeight, 0, fuel1Y);
        fuelGrad.addColorStop(0, '#00f2fe');
        fuelGrad.addColorStop(1, '#00e676');

        gameCtx.fillStyle = fuelGrad;
        gameCtx.shadowColor = humanFillPct === 1.0 ? '#00e676' : '#00f2fe';
        gameCtx.shadowBlur = humanFillPct === 1.0 ? 8 : 4;
        drawRoundedRect(gameCtx, fuelBarX, fillY, fuelBarWidth, fillHeight, 2.5);
        gameCtx.fill();
    }
    gameCtx.restore();

    // 2. AI Fuel Bar
    const fuel2Y = track2Y - fuelBarHeight / 2 + 10;
    gameCtx.save();
    gameCtx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    gameCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    gameCtx.lineWidth = 1;
    drawRoundedRect(gameCtx, fuelBarX, fuel2Y, fuelBarWidth, fuelBarHeight, 2.5);
    gameCtx.fill();
    gameCtx.stroke();

    for (let i = 1; i < 10; i++) {
        const tickY = fuel2Y + fuelBarHeight - (i / 10) * fuelBarHeight;
        gameCtx.beginPath();
        gameCtx.moveTo(fuelBarX, tickY);
        gameCtx.lineTo(fuelBarX + fuelBarWidth, tickY);
        gameCtx.stroke();
    }

    const aiFillPct = Math.min(1.0, state.aiHits / 10);
    if (aiFillPct > 0) {
        const fillHeight = fuelBarHeight * aiFillPct;
        const fillY = fuel2Y + fuelBarHeight - fillHeight;
        const fuelGrad = gameCtx.createLinearGradient(0, fuel2Y + fuelBarHeight, 0, fuel2Y);
        fuelGrad.addColorStop(0, '#ff9100');
        fuelGrad.addColorStop(1, '#ff3d00');

        gameCtx.fillStyle = fuelGrad;
        gameCtx.shadowColor = aiFillPct === 1.0 ? '#ff3d00' : '#ff9100';
        gameCtx.shadowBlur = aiFillPct === 1.0 ? 8 : 4;
        drawRoundedRect(gameCtx, fuelBarX, fillY, fuelBarWidth, fillHeight, 2.5);
        gameCtx.fill();
    }
    gameCtx.restore();

    gameCtx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// --- EVENT HANDLERS ---

function togglePlayState() {
    // Block toggle if victory screen is shown and not dismissable yet
    if (!startPrompt.classList.contains('hidden') && !state.canDismissVictory) {
        return;
    }

    state.isPlaying = !state.isPlaying;
    
    // Lazy audio context initializer
    initAudio();

    const playIcon = playBtn.querySelector('svg');

    if (state.isPlaying) {
        state.lastTime = performance.now();
        setView('game');
        
        // If restarting from a victory or starting new, clean all statistics and variables
        if (state.humanHits >= 10 || state.aiHits >= 10 || (state.lines.length === 0 && state.humanPredictions.length === 0 && state.aiPredictions.length === 0)) {
            state.gameTime = 0;
            state.humanHits = 0;
            state.humanMisses = 0;
            state.humanStreak = 0;
            
            state.aiHits = 0;
            state.aiMisses = 0;
            state.aiStreak = 0;

            state.lines = [];
            state.humanPredictions = [];
            state.aiPredictions = [];
            state.particles = [];
            state.floatingTexts = [];
            state.humanCharges = state.maxCharges;
            state.aiCharges = state.maxCharges;
            state.humanLastPressTime = 0;
            state.aiLastPressTime = 0;

            state.aiLastLineSeenId = null;
            state.aiIntervalTimer = 0;
            state.aiPendingFires = 0;
            state.aiBurstTimeouts = [];

            updateStatsUI();

            const nextInterval = sampleWeibull(state.k, state.lambda) * 1000;
            state.nextSpawnTime = state.gameTime + nextInterval;
        }

        playBtn.classList.remove('btn-primary');
        playBtn.classList.add('btn-secondary');
        playBtnText.textContent = 'Pause';
        if (playIcon) {
            playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; // Pause bars icon
        }
        
        // Ensure starting overlay is reset
        const promptTitle = startPrompt.querySelector('h3');
        const promptText = startPrompt.querySelector('p');
        const promptIcon = startPrompt.querySelector('.prompt-icon');
        const promptPlayBtn = document.getElementById('promptPlayBtn');
        
        promptIcon.textContent = 'SPACE';
        promptIcon.style.color = '';
        promptIcon.style.borderColor = '';
        promptTitle.textContent = 'Weibull Rhythm Duel';
        promptText.textContent = 'Race the AI opponent to 10 prediction hits! Tap preset & strategy buttons on the control panel to customize, and press SPACE (or click Play) to begin the duel.';
        promptPlayBtn.textContent = 'Start Duel';

        startPrompt.classList.add('hidden');
    } else {
        playBtn.classList.remove('btn-secondary');
        playBtn.classList.add('btn-primary');
        playBtnText.textContent = 'Play';
        if (playIcon) {
            playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; // Play triangle icon
        }
    }
}

function handleSpaceInput(e) {
    if (e.code === 'Space') {
        // Prevent browser scrolling behavior
        e.preventDefault();
        
        // Blur whatever is currently focused so spacebar doesn't trigger its click event
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        
        if (state.isPlaying) {
            makeHumanPrediction(state.gameTime);
        } else {
            togglePlayState();
        }
    }
}

// Preset selection bindings
function setPreset(presetName, kVal, lambdaVal) {
    state.preset = presetName;
    state.k = kVal;
    state.lambda = lambdaVal;

    [presetClustered, presetMemoryless, presetFrailty].forEach(btn => btn.classList.remove('active'));
    if (presetName === 'clustered') presetClustered.classList.add('active');
    else if (presetName === 'memoryless') presetMemoryless.classList.add('active');
    else if (presetName === 'frailty') presetFrailty.classList.add('active');

    drawPDF();
}

presetClustered.addEventListener('click', () => {
    setPreset('clustered', 0.7, 1.6);
    presetClustered.blur();
});
presetMemoryless.addEventListener('click', () => {
    setPreset('memoryless', 1.0, 2.0);
    presetMemoryless.blur();
});
presetFrailty.addEventListener('click', () => {
    setPreset('frailty', 5.0, 2.18);
    presetFrailty.blur();
});

// Strategy selection bindings
function setStrategy(strategyName) {
    state.aiStrategy = strategyName;

    [stratRandom, stratInterval, stratBursty].forEach(btn => btn.classList.remove('active'));
    if (strategyName === 'random') stratRandom.classList.add('active');
    else if (strategyName === 'interval') stratInterval.classList.add('active');
    else if (strategyName === 'bursty') stratBursty.classList.add('active');
    
    // Trigger re-render to update track label strategy text immediately
    renderGame();
}

stratRandom.addEventListener('click', () => {
    setStrategy('random');
    stratRandom.blur();
});
stratInterval.addEventListener('click', () => {
    setStrategy('interval');
    stratInterval.blur();
});
stratBursty.addEventListener('click', () => {
    setStrategy('bursty');
    stratBursty.blur();
});

playBtn.addEventListener('click', () => {
    togglePlayState();
    playBtn.blur();
});
playBtn.addEventListener('mouseup', () => playBtn.blur());
playBtn.addEventListener('touchend', () => playBtn.blur());

promptPlayBtn.addEventListener('click', () => {
    togglePlayState();
    promptPlayBtn.blur();
});
promptPlayBtn.addEventListener('mouseup', () => promptPlayBtn.blur());
promptPlayBtn.addEventListener('touchend', () => promptPlayBtn.blur());

audioBtn.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    if (state.isMuted) {
        audioBtnText.textContent = 'Unmute';
        audioIcon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    } else {
        audioBtnText.textContent = 'Mute';
        audioIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
    audioBtn.blur();
});
audioBtn.addEventListener('mouseup', () => audioBtn.blur());
audioBtn.addEventListener('touchend', () => audioBtn.blur());

resetBtn.addEventListener('click', () => {
    resetStats();
    resetBtn.blur();
});
resetBtn.addEventListener('mouseup', () => resetBtn.blur());
resetBtn.addEventListener('touchend', () => resetBtn.blur());

// Universal document click listener to clear stuck focus
document.addEventListener('click', (e) => {
    if (!e.target.closest('input, button, select, textarea')) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }
});

// View switching logic for Single Page App (SPA) responsive views
function setView(viewName) {
    state.currentView = viewName;
    if (window.innerWidth <= 768) {
        if (viewName === 'setup') {
            setupView.classList.remove('hidden');
            gameView.classList.remove('active-view');
        } else {
            setupView.classList.add('hidden');
            gameView.classList.add('active-view');
        }
    } else {
        // Desktop: show both side-by-side
        setupView.classList.remove('hidden');
        gameView.classList.remove('active-view');
    }
}

// Mobile setup start button click handler
setupStartBtn.addEventListener('click', () => {
    setView('game');
    if (!state.isPlaying) {
        togglePlayState();
    }
    setupStartBtn.blur();
});

// Mobile game HUD back button click handler
backToSetupBtn.addEventListener('click', () => {
    if (state.isPlaying) {
        togglePlayState();
    }
    setView('setup');
    backToSetupBtn.blur();
});

// Capture keydown in capturing phase to block focused elements from consuming Spacebar events
window.addEventListener('keydown', handleSpaceInput, true);
window.addEventListener('resize', () => {
    handleResize();
    setView(state.currentView);
});

// --- APP INITIALIZATION ---

function init() {
    handleResize();
    setPreset('clustered', 0.7, 1.6);
    setStrategy('random');
    setView('setup');
    updateStatsUI();
    
    // Tap / Touch input for mobile playability on canvas
    gameCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // Block double-tap to zoom or standard context menus
        if (state.isPlaying) {
            makeHumanPrediction(state.gameTime);
        }
    }, { passive: false });
    
    // Initial clear screen
    renderGame();
    
    // Start animation loop
    requestAnimationFrame(gameLoop);
}

// Kickstart application
init();
