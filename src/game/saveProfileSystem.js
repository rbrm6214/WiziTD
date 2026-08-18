const STORAGE_KEY = "wizitd_profiles_v1";
const SCHEMA_VERSION = 1;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(n));
}

function normalizeDifficulty(value) {
  const v = String(value ?? "medium").toLowerCase();
  if (v === "easy" || v === "hard" || v === "extreme") {
    return v;
  }
  return "medium";
}

function normalizeGameMode(value) {
  const v = String(value ?? "standard").toLowerCase();
  if (v === "triple" || v === "solo") {
    return v;
  }
  return "standard";
}

function normalizeProfileName(name) {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ");
  return cleaned.slice(0, 32) || "joueur";
}

function splitSuffix(name) {
  const match = String(name).match(/^(.*)_(\d{2})$/);
  if (!match) {
    return { base: String(name), suffix: null };
  }
  return {
    base: match[1],
    suffix: safeInt(match[2], 0),
  };
}

export function resolveImportedNameCollision(desiredName, usedNames) {
  const normalizedDesired = normalizeProfileName(desiredName);
  if (!usedNames.has(normalizedDesired)) {
    return normalizedDesired;
  }

  const parsed = splitSuffix(normalizedDesired);
  const base = parsed.base;
  let index = parsed.suffix == null ? 1 : parsed.suffix;

  while (index <= 9999) {
    const candidate = `${base}_${String(index).padStart(2, "0")}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
    index += 1;
  }

  return `${base}_${Date.now()}`;
}

function createDefaultProfileState({ name, difficulty = "medium", gameMode = "standard" }) {
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `profile-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`,
    name: normalizeProfileName(name),
    createdAt: now,
    updatedAt: now,
    config: {
      difficulty: normalizeDifficulty(difficulty),
      gameMode: normalizeGameMode(gameMode),
      missionId: "balanced",
      mapLocked: false,
    },
    stats: {
      totalKills: 0,
      totalRuns: 0,
      totalXp: 0,
      playerLevel: 0,
      sagesseDisponible: 0,
      sagesseDepensee: 0,
      sagesseTotaleGagnee: 0,
      bestWave: 0,
      highestWaveEver: 0,
      totalPlayTimeSeconds: 0,
      wins: 0,
    },
    knowledge: {
      levels: {},
      unlocked: {},
    },
    metaSnapshot: null,
    runState: null,
  };
}

function migrateProfile(raw) {
  const name = normalizeProfileName(raw?.name ?? raw?.playerName ?? "joueur");
  const profile = createDefaultProfileState({
    name,
    difficulty: normalizeDifficulty(raw?.config?.difficulty ?? raw?.difficulty),
    gameMode: normalizeGameMode(raw?.config?.gameMode ?? raw?.gameMode),
  });

  profile.schemaVersion = SCHEMA_VERSION;
  profile.id = String(raw?.id ?? profile.id);
  profile.createdAt = String(raw?.createdAt ?? raw?.dateCreation ?? profile.createdAt);
  profile.updatedAt = String(raw?.updatedAt ?? raw?.dateDerniereMaj ?? profile.updatedAt);
  profile.config = {
    ...profile.config,
    ...deepClone(raw?.config ?? {}),
    difficulty: normalizeDifficulty(raw?.config?.difficulty ?? raw?.difficulty ?? profile.config.difficulty),
    gameMode: normalizeGameMode(raw?.config?.gameMode ?? raw?.gameMode ?? profile.config.gameMode),
    missionId: "balanced",
    mapLocked: !!(raw?.config?.mapLocked ?? raw?.mapLocked ?? false),
  };

  const mergedStats = {
    ...profile.stats,
    ...(raw?.stats ?? {}),
  };
  profile.stats = {
    totalKills: safeInt(mergedStats.totalKills),
    totalRuns: safeInt(mergedStats.totalRuns),
    totalXp: safeInt(mergedStats.totalXp),
    playerLevel: Math.max(0, safeInt(mergedStats.playerLevel, 0)),
    sagesseDisponible: safeInt(mergedStats.sagesseDisponible ?? mergedStats.sagessePoints),
    sagesseDepensee: safeInt(mergedStats.sagesseDepensee),
    sagesseTotaleGagnee: safeInt(
      mergedStats.sagesseTotaleGagnee
        ?? safeInt(mergedStats.sagesseDisponible ?? mergedStats.sagessePoints)
        + safeInt(mergedStats.sagesseDepensee),
    ),
    bestWave: safeInt(mergedStats.bestWave),
    highestWaveEver: safeInt(mergedStats.highestWaveEver ?? mergedStats.bestWave),
    totalPlayTimeSeconds: safeInt(mergedStats.totalPlayTimeSeconds),
    wins: safeInt(mergedStats.wins),
  };

  profile.knowledge = {
    levels: deepClone(raw?.knowledge?.levels ?? raw?.knowledgeLevels ?? {}),
    unlocked: deepClone(raw?.knowledge?.unlocked ?? raw?.knowledgeUnlocked ?? {}),
  };

  profile.metaSnapshot = raw?.metaSnapshot ? deepClone(raw.metaSnapshot) : null;

  profile.runState = raw?.runState ? deepClone(raw.runState) : null;
  profile.name = name;
  return profile;
}

export function computeUnlocksFromProfiles(profiles) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const tripleUnlocked = rows.some((profile) => safeInt(profile?.stats?.bestWave) >= 500);
  const soloUnlocked = rows.some(
    (profile) => normalizeGameMode(profile?.config?.gameMode) === "triple" && safeInt(profile?.stats?.bestWave) >= 500,
  );
  const extremeUnlocked = rows.some(
    (profile) => normalizeGameMode(profile?.config?.gameMode) === "solo" && safeInt(profile?.stats?.bestWave) >= 500,
  );
  return {
    tripleUnlocked,
    soloUnlocked,
    extremeUnlocked,
  };
}

export class SaveProfileSystem {
  constructor({ storage = globalThis?.localStorage ?? null } = {}) {
    this.storage = storage;
    this.profiles = [];
  }

  load() {
    if (!this.storage) {
      this.profiles = [];
      return this.profiles;
    }

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) {
        this.profiles = [];
        return this.profiles;
      }
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.profiles) ? parsed.profiles : Array.isArray(parsed) ? parsed : [];
      this.profiles = list.map((entry) => migrateProfile(entry));
      return this.profiles;
    } catch {
      this.profiles = [];
      return this.profiles;
    }
  }

  save() {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        profiles: this.profiles,
      }),
    );
  }

  list() {
    return this.profiles.map((profile) => deepClone(profile));
  }

  getById(id) {
    return deepClone(this.profiles.find((profile) => profile.id === id) ?? null);
  }

  createProfile({ name, difficulty = "medium", gameMode = "standard" }) {
    const usedNames = new Set(this.profiles.map((profile) => profile.name));
    const resolvedName = resolveImportedNameCollision(name, usedNames);
    const profile = createDefaultProfileState({
      name: resolvedName,
      difficulty,
      gameMode,
    });
    this.profiles.push(profile);
    this.save();
    return deepClone(profile);
  }

  upsertProfile(profile) {
    const migrated = migrateProfile(profile);
    migrated.updatedAt = nowIso();
    const index = this.profiles.findIndex((entry) => entry.id === migrated.id);
    if (index >= 0) {
      this.profiles[index] = migrated;
    } else {
      this.profiles.push(migrated);
    }
    this.save();
    return deepClone(migrated);
  }

  deleteProfile(id) {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      return false;
    }
    this.profiles.splice(index, 1);
    this.save();
    return true;
  }

  getUnlocks() {
    return computeUnlocksFromProfiles(this.profiles);
  }

  buildExportPayload(profileId) {
    const profile = this.profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      return null;
    }
    return {
      format: "wizitd-save",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso(),
      profile: deepClone(profile),
    };
  }

  buildExportFilename(profile, date = new Date()) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${normalizeProfileName(profile?.name ?? "profil")}_${yy}_${mm}_${dd}.wizisav`;
  }

  importPayload(payload) {
    const profile = migrateProfile(payload?.profile ?? payload);
    const usedNames = new Set(this.profiles.map((entry) => entry.name));
    profile.name = resolveImportedNameCollision(profile.name, usedNames);
    profile.id = `profile-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
    profile.updatedAt = nowIso();
    if (!profile.createdAt) {
      profile.createdAt = profile.updatedAt;
    }
    this.profiles.push(profile);
    this.save();
    return deepClone(profile);
  }
}
