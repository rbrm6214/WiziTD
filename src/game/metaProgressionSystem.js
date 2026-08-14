const STORAGE_KEY = "wizitd_meta_v1";

const DEFAULT_KNOWLEDGE_LEVELS = {
  economy: 0,
  offense: 0,
  defense: 0,
  merchant: 0,
  watchman: 0,
  brisk: 0,
  experienced: 0,
  scored: 0,
  investor: 0,
  builder: 0,
  shop: 0,
};

const DEFAULT_KNOWLEDGE_UNLOCKED = {
  reveal: false,
  linker: false,
  packArchitect: false,
};

const DEFAULT_META = {
  playerLevel: 1,
  playerXp: 0,
  sagessePoints: 0,
  knowledgeLevels: DEFAULT_KNOWLEDGE_LEVELS,
  knowledgeUnlocked: DEFAULT_KNOWLEDGE_UNLOCKED,
  runs: 0,
  wins: 0,
  totalKills: 0,
  bestWave: 0,
  highestWaveEver: 0,
  extremeUnlocked: false,
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_META));
}

function getDifficultyTier(difficulty) {
  const value = String(difficulty ?? "medium").toLowerCase();
  if (value === "easy") {
    return "easy";
  }
  if (value === "hard" || value === "extreme") {
    return "hard";
  }
  return "medium";
}

export class MetaProgressionSystem {
  constructor({ registry, storage = globalThis?.localStorage ?? null }) {
    this.registry = registry;
    this.storage = storage;
    this.state = cloneDefault();
  }

  load() {
    if (!this.storage) {
      this.state = cloneDefault();
      return this.state;
    }

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) {
        this.state = cloneDefault();
        return this.state;
      }
      const parsed = JSON.parse(raw);
      const migratedKnowledgeLevels = {
        ...DEFAULT_KNOWLEDGE_LEVELS,
        ...(parsed.knowledgeLevels ?? {}),
        ...(parsed.wisdomSpent ?? {}),
      };
      const migratedKnowledgeUnlocked = {
        ...DEFAULT_KNOWLEDGE_UNLOCKED,
        ...(parsed.knowledgeUnlocked ?? {}),
      };
      this.state = {
        ...cloneDefault(),
        ...parsed,
        sagessePoints: Math.max(
          0,
          Math.floor(parsed.sagessePoints ?? parsed.wisdomPoints ?? cloneDefault().sagessePoints),
        ),
        knowledgeLevels: migratedKnowledgeLevels,
        knowledgeUnlocked: migratedKnowledgeUnlocked,
        highestWaveEver: Math.max(
          0,
          Math.floor(parsed.highestWaveEver ?? parsed.bestWave ?? cloneDefault().highestWaveEver),
        ),
        extremeUnlocked: !!(parsed.extremeUnlocked ?? false),
      };
      return this.state;
    } catch {
      this.state = cloneDefault();
      return this.state;
    }
  }

  save() {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  invest(pointType) {
    return this.purchaseKnowledge(pointType, { cost: 1, maxLevel: Number.POSITIVE_INFINITY });
  }

  completeWave(wave) {
    const completedWave = Math.max(0, Math.floor(wave));
    let sagesseGain = 0;
    this.state.bestWave = Math.max(this.state.bestWave, completedWave);

    if (completedWave > this.state.highestWaveEver) {
      sagesseGain += 1;
      this.state.highestWaveEver = completedWave;
    }

    if (completedWave > 0 && completedWave % 25 === 0) {
      sagesseGain += 1;
    }

    if (completedWave >= 500) {
      this.state.extremeUnlocked = true;
    }

    this.state.sagessePoints += sagesseGain;
    this.save();

    return {
      sagesseGain,
      highestWaveEver: this.state.highestWaveEver,
      extremeUnlocked: this.state.extremeUnlocked,
    };
  }

  grantSagesse(amount = 0) {
    const gained = Math.max(0, Math.floor(amount));
    if (gained <= 0) {
      return 0;
    }
    this.state.sagessePoints += gained;
    this.save();
    return gained;
  }

  unlockExtreme() {
    this.state.extremeUnlocked = true;
    this.save();
  }

  spendSagesse(cost) {
    const amount = Math.max(0, Math.floor(cost));
    if (amount <= 0) {
      return true;
    }
    if (this.state.sagessePoints < amount) {
      return false;
    }
    this.state.sagessePoints -= amount;
    this.save();
    return true;
  }

  purchaseKnowledge(key, { cost = 1, maxLevel = Number.POSITIVE_INFINITY, oneShot = false, difficulty = "medium" } = {}) {
    const normalizedCost = Math.max(1, Math.floor(cost));
    const effectiveCost = String(difficulty ?? "medium").toLowerCase() === "extreme"
      ? normalizedCost * 2
      : normalizedCost;

    if (this.state.sagessePoints < effectiveCost) {
      return false;
    }

    if (oneShot) {
      if (!Object.hasOwn(this.state.knowledgeUnlocked, key) || this.state.knowledgeUnlocked[key]) {
        return false;
      }
      this.state.sagessePoints -= effectiveCost;
      this.state.knowledgeUnlocked[key] = true;
      this.save();
      return true;
    }

    if (!Object.hasOwn(this.state.knowledgeLevels, key)) {
      return false;
    }

    const currentLevel = Math.max(0, Math.floor(this.state.knowledgeLevels[key] ?? 0));
    if (Number.isFinite(maxLevel) && currentLevel >= maxLevel) {
      return false;
    }

    this.state.sagessePoints -= effectiveCost;
    this.state.knowledgeLevels[key] = currentLevel + 1;
    this.save();
    return true;
  }

  getRunBonuses(difficulty = "medium") {
    const tier = getDifficultyTier(difficulty);
    const economy = this.state.knowledgeLevels.economy;
    const offense = this.state.knowledgeLevels.offense;
    const defense = this.state.knowledgeLevels.defense;
    const merchant = this.state.knowledgeLevels.merchant;
    const watchman = this.state.knowledgeLevels.watchman;
    const brisk = this.state.knowledgeLevels.brisk;
    const experienced = this.state.knowledgeLevels.experienced;
    const scored = this.state.knowledgeLevels.scored;
    const investor = this.state.knowledgeLevels.investor;
    const builder = this.state.knowledgeLevels.builder;
    const shop = this.state.knowledgeLevels.shop;

    const startGoldPerPoint = tier === "easy" ? 24 : tier === "hard" ? 6 : 12;
    const towerDamageRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const portalLivesPerPoint = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
    const merchantRate = tier === "easy" ? 0.02 : tier === "hard" ? 0.005 : 0.01;
    const watchmanRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const experiencedRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const briskRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const scoredRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const investorRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const shopRate = tier === "easy" ? 0.03 : tier === "hard" ? 0.01 : 0.02;
    const linkerRadius = tier === "easy" ? 500 : tier === "hard" ? 100 : 200;

    return {
      bonusStartingGold: economy * startGoldPerPoint,
      bonusTowerDamageMul: 1 + offense * towerDamageRate,
      bonusPortalLives: defense * portalLivesPerPoint,
      bonusTowerCostMul: Math.max(0.1, 1 - merchant * merchantRate),
      bonusTowerRangeMul: 1 + watchman * watchmanRate,
      bonusTowerAttackSpeedMul: 1 + brisk * briskRate,
      bonusTowerXpMul: 1 + experienced * experiencedRate,
      bonusScoreMul: 1 + scored * scoredRate,
      bonusKillGoldMul: 1 + investor * investorRate,
      bonusShopCostMul: Math.max(0.1, 1 - shop * shopRate),
      towerMaxLevel: 10 + builder,
      shopLevel: shop,
      linkerRadius,
      revealUnlocked: !!this.state.knowledgeUnlocked.reveal,
      linkerUnlocked: !!this.state.knowledgeUnlocked.linker,
      packArchitectUnlocked: !!this.state.knowledgeUnlocked.packArchitect,
      bonusLevelThreshold: 10,
    };
  }

  getPlayerXpProgress() {
    const currentLevel = Math.max(1, Math.floor(this.state.playerLevel ?? 1));
    const currentXp = Math.max(0, Math.floor(this.state.playerXp ?? 0));
    const nextLevelXp = this._xpForLevel(currentLevel);
    const ratio = nextLevelXp > 0 ? Math.max(0, Math.min(1, currentXp / nextLevelXp)) : 0;

    return {
      currentLevel,
      currentXp,
      nextLevelXp,
      ratio,
    };
  }

  applyRunResult({ won, wave, kills, score }) {
    const previousLevel = Math.max(1, Math.floor(this.state.playerLevel ?? 1));
    this.state.runs += 1;
    if (won) {
      this.state.wins += 1;
    }
    this.state.totalKills += Math.max(0, kills);
    this.state.bestWave = Math.max(this.state.bestWave, Math.max(0, wave));

    const xpGain = Math.max(12, Math.floor(wave * 7 + kills * 1.6 + score * 0.02 + (won ? 40 : 0)));
    this._gainXp(xpGain);

    if (wave >= 500) {
      this.state.extremeUnlocked = true;
    }

    this.save();

    return {
      xpGain,
      previousLevel,
      currentLevel: this.state.playerLevel,
      levelsGained: Math.max(0, this.state.playerLevel - previousLevel),
      leveled: this.state.playerLevel,
    };
  }

  _gainXp(amount) {
    this.state.playerXp += amount;

    while (true) {
      const need = this._xpForLevel(this.state.playerLevel);
      if (this.state.playerXp < need) {
        break;
      }
      this.state.playerXp -= need;
      this.state.playerLevel += 1;
      this.state.sagessePoints += 1;
    }
  }

  _xpForLevel(level) {
    const bucket = this.registry.buckets?.get("doc_player_level_experience");
    if (bucket && bucket.size > 0) {
      const found = bucket.get(level + 1) ?? null;
      if (found && Number.isFinite(found.exp)) {
        return Math.max(20, Math.floor(found.exp));
      }
    }

    return Math.floor(100 + level * 42 + level * level * 6);
  }
}
