const FALLBACK_MISSIONS = {
  balanced: {
    id: "balanced",
    label: "Balanced Run",
    difficulty: "medium",
    waveTarget: 20,
    startingGold: 150,
    portalLives: 20,
  },
  hard: {
    id: "hard",
    label: "Hard Pressure",
    difficulty: "hard",
    waveTarget: 24,
    startingGold: 130,
    portalLives: 18,
  },
  rush: {
    id: "rush",
    label: "Rush Economy",
    difficulty: "medium",
    waveTarget: 22,
    startingGold: 110,
    portalLives: 24,
  },
};

export function createMissionPresets(registry) {
  void registry;

  return {
    presets: FALLBACK_MISSIONS,
    order: Object.keys(FALLBACK_MISSIONS),
    source: "fallback",
  };
}
