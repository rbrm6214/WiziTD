import { describe, expect, it } from "vitest";
import {
  computeUnlocksFromProfiles,
  resolveImportedNameCollision,
  SaveProfileSystem,
} from "./saveProfileSystem.js";

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

describe("saveProfileSystem", () => {
  it("resolves imported name collisions with _xx suffix", () => {
    const used = new Set(["pseudo", "pseudo_01", "pseudo_02"]);
    expect(resolveImportedNameCollision("pseudo", used)).toBe("pseudo_03");
  });

  it("increments existing suffixed names", () => {
    const used = new Set(["alpha_09", "alpha_10"]);
    expect(resolveImportedNameCollision("alpha_09", used)).toBe("alpha_11");
  });

  it("computes unlocks from profile list", () => {
    const unlocks = computeUnlocksFromProfiles([
      { config: { gameMode: "standard" }, stats: { bestWave: 500 } },
      { config: { gameMode: "triple" }, stats: { bestWave: 500 } },
      { config: { gameMode: "solo" }, stats: { bestWave: 500 } },
    ]);

    expect(unlocks.tripleUnlocked).toBe(true);
    expect(unlocks.soloUnlocked).toBe(true);
    expect(unlocks.extremeUnlocked).toBe(true);
  });

  it("exports and imports a profile with persisted fields", () => {
    const storage = createMemoryStorage();
    const system = new SaveProfileSystem({ storage });
    system.load();

    const created = system.createProfile({ name: "joueur", difficulty: "hard", gameMode: "standard" });
    const saved = {
      ...created,
      stats: {
        ...created.stats,
        bestWave: 512,
        totalPlayTimeSeconds: 1234,
      },
    };
    system.upsertProfile(saved);

    const payload = system.buildExportPayload(created.id);
    expect(payload?.profile?.stats?.bestWave).toBe(512);

    const imported = system.importPayload(payload);
    expect(imported.name.startsWith("joueur")).toBe(true);
    expect(imported.stats.totalPlayTimeSeconds).toBe(1234);
    expect(system.list().length).toBe(2);
  });
});
