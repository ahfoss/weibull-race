# Weibull Rhythm Duel

Predict the tempo of randomness. A sleek, mathematically sound, interactive rhythm game based on interarrival times sampled from a Weibull distribution. Race against simulated AI strategies in real time!

[Click to play here](https://ahfoss.github.io/weibull-race/)
Try it on desktop or mobile: **works on all modern web browsers.**

## Features

- **Dual-Track Dueling**: Divided visual canvas where you (Human) compete side-by-side against an AI opponent.
- **Mathematical Presets**:
  - **Clustered** ($k = 0.7$, $\lambda = 1.6s$): High-variance, bursty arrivals.
  - **Memoryless** ($k = 1.0$, $\lambda = 2.0s$): Poisson process, independent arrivals.
  - **Frailty** ($k = 5.0$, $\lambda = 2.18s$): Low-variance, highly regular periodic arrivals.
- **Simulated AI Strategies**:
  - **Random**: Randomly predicts, with threshold triggers to avoid wasted charge caps.
  - **Interval**: Calculates the theoretical mean interval ($\mu$) and fires charges after a target spawns.
  - **Bursty**: Fires a rapid succession of predictions immediately after observing a spawn.
- **Mobile Optimized Layout**:
  - **Responsive Views**: Automatically switches to full-screen single views (Setup View and Game View) on mobile viewports ($\le 768\text{px}$) while maintaining a side-by-side sidebar grid on desktops.
  - **Mobile HUD Bar**: Real-time HUD displaying scores and elapsed time directly above the canvas for quick reading.
  - **Tap Controls**: Tapping/touching anywhere on the canvas triggers prediction entries on mobile, replacing the desktop Spacebar.
- **Live PDF Rendering**: Visualizes the Weibull Probability Density Function curve along with calculated theoretical Mean ($\mu$) and Standard Deviation ($\sigma$) values dynamically.
- **Synthesized Audio**: Retro sound effects generated directly via the Web Audio API.

## How to Play

1. **Configure**: Select a parameter **Preset** (Clustered, Memoryless, or Frailty) and choose an **AI Strategy** to play against.
2. **Start**: Click **Start Duel**.
3. **Predict**:
   - **Desktop**: Press the **Spacebar** to fire prediction blocks.
   - **Mobile**: **Tap anywhere on the canvas** to fire prediction blocks.
4. **Win Conditions**: 
   - A prediction is a **Hit** if it lands within $0.35s$ before a target line spawns.
   - Late presses or empty entries result in a **Miss**.
   - The first player (Human or AI) to reach **10 successful hits** wins the duel. 
   - Post-game reviews provide suited strategy recommendations based on the preset.

## Running Locally

Simply double-click `index.html` to open the game in any modern browser, or run a local server:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.

## License

This project is licensed under the [MIT License](LICENSE).
