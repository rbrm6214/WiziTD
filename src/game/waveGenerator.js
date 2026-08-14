const WAVE_TYPE_WEIGHTS = [
  { type: "MASS", weight: 0.15 },
  { type: "NORMAL", weight: 0.5 },
  { type: "AIR", weight: 0.15 },
  { type: "BOSS", weight: 0.2 },
];

const ARMOR_TYPES = ["light", "heavy", "immune", "divin"];

const ACTIVE_SPECIAL_NAMES = new Set([
  "speed",
  "greater speed",
  "xtreme speed",
  "slow",
  "strong",
  "rich",
  "armored",
  "heavy armored",
  "xtreme armor",
  "spell resistance",
  "magic immunity",
  "slow aura",
  "regeneration",
  "xtreme regeneration",
  "second chance",
  "evolving",
  "protector",
  "meaty",
  "invisible",
]);

const SPECIAL_OVERRIDES = {
  invisible: { enabled: true, requiredWaveLevel: 10 },
};

const SPAWN_DELAY_RANGES = {
  MASS: { min: 0.15, max: 0.4 },
  NORMAL: { min: 0.4, max: 2.2 },
  AIR: { min: 1.0, max: 3.0 },
  BOSS: { min: 1.5, max: 9.0 },
};

const COUNT_MULTIPLIER = {
  MASS: 2.4,
  NORMAL: 1.0,
  AIR: 0.65,
  BOSS: 0.28,
};

const CHAMPION_RANGES = {
  MASS: [0, 1],
  NORMAL: [0, 3],
  AIR: [0, 2],
  BOSS: [1, 2],
};

const DIFFICULTY_HP_FACTOR = {
  easy: 0.85,
  medium: 1.0,
  hard: 1.25,
  extreme: 1.55,
};

const DIFFICULTY_ARMOR_FACTOR = {
  easy: 0.85,
  medium: 1.0,
  hard: 1.2,
  extreme: 1.5,
};

function weightedPick(rng, weightedList) {
  const total = weightedList.reduce((acc, item) => acc + item.weight, 0);
  let cursor = rng.range(0, total);

  for (const item of weightedList) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.type;
    }
  }

  return weightedList[weightedList.length - 1].type;
}

function normalizeSpecialName(special) {
  return String(special?.name_english ?? special?.label ?? "")
    .trim()
    .toLowerCase();
}

function getSpecialOverride(special) {
  return SPECIAL_OVERRIDES[normalizeSpecialName(special)] ?? null;
}

function calcBaseHp(level, difficulty) {
  const factor = DIFFICULTY_HP_FACTOR[difficulty] ?? DIFFICULTY_HP_FACTOR.medium;
  const raw = 90 + level * level * 2.2 + level * 14;
  return Math.floor(raw * factor);
}

function calcArmor(level, difficulty) {
  const factor = DIFFICULTY_ARMOR_FACTOR[difficulty] ?? DIFFICULTY_ARMOR_FACTOR.medium;
  return Math.floor((2 + level * 0.35) * factor);
}

export class WaveGenerator {
  constructor({ rng, difficulty = "medium", specialPool = [] }) {
    this.rng = rng;
    this.difficulty = difficulty;
    this.specialPool = specialPool;
  }

  generate(waveLevel) {
    const mainType = weightedPick(this.rng, WAVE_TYPE_WEIGHTS);
    const isChallengeWave = waveLevel % 8 === 0;
    const isChallengeMass = isChallengeWave && waveLevel % 16 === 0;
    const capacity = 20 + waveLevel / 40;

    const armorType =
      waveLevel >= 32 && this.rng.next() < 0.15
        ? "life"
        : this.rng.pick(ARMOR_TYPES);

    const [championMin, championMax] = CHAMPION_RANGES[mainType];
    const championCount = this.rng.int(championMin, championMax);

    const unitCount = Math.max(1, Math.floor(capacity * COUNT_MULTIPLIER[mainType]));
    const health = Math.floor(
      calcBaseHp(waveLevel, this.difficulty) * (armorType === "life" ? 1.25 : 1.0),
    );
    const armor = calcArmor(waveLevel, this.difficulty);

    const specialCountRoll = this.rng.next();
    const specialCount = specialCountRoll < 0.5 ? 0 : specialCountRoll < 0.85 ? 1 : 2;
    const specials = this._pickSpecials(waveLevel, mainType, specialCount);

    return {
      id: waveLevel,
      mainType,
      isChallengeWave,
      isChallengeMass,
      unitCount,
      championCount,
      capacity,
      health,
      armor,
      armorType,
      spawnDelay: SPAWN_DELAY_RANGES[mainType],
      specials,
    };
  }

  _pickSpecials(waveLevel, mainType, count) {
    if (count === 0 || this.specialPool.length === 0) {
      return [];
    }

    const eligible = this.specialPool.filter((special) => {
      const override = getSpecialOverride(special);
      const specialName = normalizeSpecialName(special);
      if (!ACTIVE_SPECIAL_NAMES.has(specialName)) {
        return false;
      }

      const minWave = Number.isFinite(override?.requiredWaveLevel)
        ? override.requiredWaveLevel
        : Number.isFinite(special.required_wave_level)
          ? special.required_wave_level
        : 0;
      if (waveLevel < minWave) {
        return false;
      }

      const creepSizes = String(special.creep_sizes ?? "all").toLowerCase();
      if (creepSizes !== "all") {
        const mapType = mainType.toLowerCase();
        if (!creepSizes.includes(mapType)) {
          return false;
        }
      }

      const enabled = override?.enabled ?? special.enabled;
      return enabled !== false;
    });

    if (eligible.length === 0) {
      return [];
    }

    const selected = [];
    const usedGroups = new Set();
    const available = [...eligible];

    while (selected.length < count && available.length > 0) {
      const weighted = available.map((special) => ({
        special,
        weight: Math.max(1, Number(special.frequency) || 1),
      }));
      const pickedName = weightedPick(this.rng, weighted.map((entry) => ({ type: entry.special.id, weight: entry.weight })));
      const pickedIndex = available.findIndex((special) => special.id === pickedName);
      const special = pickedIndex >= 0 ? available.splice(pickedIndex, 1)[0] : available.shift();
      if (!special) {
        break;
      }

      const groups = String(special.group_list ?? "")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      const intersects = groups.some((group) => usedGroups.has(group));
      if (intersects) {
        continue;
      }

      selected.push(special);
      for (const group of groups) {
        usedGroups.add(group);
      }
    }

    return selected;
  }
}
