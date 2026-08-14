export class FixedStepLoop {
  constructor({ stepMs = 1000 / 60, maxSubSteps = 5, update, render }) {
    this.stepMs = stepMs;
    this.stepSeconds = stepMs / 1000;
    this.maxSubSteps = maxSubSteps;
    this.updateFn = update;
    this.renderFn = render;

    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.rafId = 0;

    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  _tick(now) {
    if (!this.running) {
      return;
    }

    const frameTimeMs = Math.min(now - this.lastTime, 250);
    this.lastTime = now;
    this.accumulator += frameTimeMs;

    let subSteps = 0;
    while (this.accumulator >= this.stepMs && subSteps < this.maxSubSteps) {
      this.updateFn(this.stepSeconds);
      this.accumulator -= this.stepMs;
      subSteps += 1;
    }

    this.renderFn();
    this.rafId = requestAnimationFrame(this._tick);
  }
}
