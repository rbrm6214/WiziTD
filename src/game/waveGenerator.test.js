import { describe, expect, it } from "vitest";
import { WaveGenerator } from "./waveGenerator.js";

class StubRng {
  constructor() {
    this.value = 0.25;
  }

  next() {
    return this.value;
  }

  range(min, max) {
    return min + (max - min) * this.value;
  }

  int(min) {
    return min;
  }

  pick(array) {
    return array[0];
  }
}

describe("WaveGenerator", () => {
  it("produces a wave object with expected keys", () => {
    const rng = new StubRng();
    const generator = new WaveGenerator({ rng, difficulty: "medium", specialPool: [] });

    const wave = generator.generate(12);

    expect(wave).toHaveProperty("id", 12);
    expect(wave).toHaveProperty("mainType");
    expect(wave).toHaveProperty("unitCount");
    expect(wave).toHaveProperty("health");
    expect(wave).toHaveProperty("armor");
    expect(wave.spawnDelay.min).toBeGreaterThan(0);
    expect(wave.spawnDelay.max).toBeGreaterThan(wave.spawnDelay.min);
  });

  it("marks challenge waves every 8 levels", () => {
    const rng = new StubRng();
    const generator = new WaveGenerator({ rng, difficulty: "medium", specialPool: [] });

    const wave8 = generator.generate(8);
    const wave9 = generator.generate(9);

    expect(wave8.isChallengeWave).toBe(true);
    expect(wave9.isChallengeWave).toBe(false);
  });

  it("uses renamed armor type labels", () => {
    const rng = new StubRng();
    const generator = new WaveGenerator({ rng, difficulty: "medium", specialPool: [] });

    const wave = generator.generate(12);

    expect(["light", "heavy", "immune", "divin", "life"]).toContain(wave.armorType);
  });
});
