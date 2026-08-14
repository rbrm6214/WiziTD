export class WaveSpawner {
  constructor({ rng, bus }) {
    this.rng = rng;
    this.bus = bus;
    this.activeWaves = [];
  }

  start(wave) {
    this.activeWaves.push({
      wave,
      remaining: wave.unitCount,
      spawned: 0,
      spawnTimer: 0,
    });
    this.bus.emit("wave:started", { waveId: wave.id, wave });
  }

  isDone() {
    return this.activeWaves.length === 0;
  }

  hasActiveWave() {
    return this.activeWaves.length > 0;
  }

  getActiveWave() {
    if (this.activeWaves.length === 0) {
      return null;
    }
    return this.activeWaves[this.activeWaves.length - 1].wave;
  }

  getActiveWaveCount() {
    return this.activeWaves.length;
  }

  clear() {
    this.activeWaves = [];
  }

  getSnapshot() {
    return this.activeWaves.map((entry) => ({
      wave: entry.wave,
      remaining: entry.remaining,
      spawned: entry.spawned,
      spawnTimer: entry.spawnTimer,
    }));
  }

  restoreSnapshot(snapshot) {
    if (!Array.isArray(snapshot)) {
      this.activeWaves = [];
      return;
    }

    this.activeWaves = snapshot
      .filter((entry) => entry?.wave)
      .map((entry) => ({
        wave: entry.wave,
        remaining: Math.max(0, Math.floor(Number(entry.remaining) || 0)),
        spawned: Math.max(0, Math.floor(Number(entry.spawned) || 0)),
        spawnTimer: Number.isFinite(entry.spawnTimer) ? Number(entry.spawnTimer) : 0,
      }));
  }

  update(dt, spawnFn) {
    if (this.activeWaves.length === 0) {
      return;
    }

    for (let i = this.activeWaves.length - 1; i >= 0; i -= 1) {
      const state = this.activeWaves[i];
      if (state.remaining <= 0) {
        this.activeWaves.splice(i, 1);
        continue;
      }

      state.spawnTimer -= dt;
      if (state.spawnTimer > 0) {
        continue;
      }

      const wave = state.wave;
      const isChampion = state.spawned < wave.championCount;

      spawnFn({
        wave,
        indexInWave: state.spawned,
        isChampion,
        health: Math.floor(wave.health * (isChampion ? 2.2 : 1.0)),
        armor: Math.floor(wave.armor + (isChampion ? 4 : 0)),
        speed: wave.mainType === "AIR" ? 120 : wave.mainType === "MASS" ? 78 : 95,
      });

      state.spawned += 1;
      state.remaining -= 1;
      state.spawnTimer = this.rng.range(wave.spawnDelay.min, wave.spawnDelay.max);

      if (state.remaining <= 0) {
        this.bus.emit("wave:spawn-finished", { waveId: wave.id });
        this.activeWaves.splice(i, 1);
      }
    }
  }
}
