export class Creep {
  constructor({
    id,
    speed,
    hp,
    armor = 0,
    pathMap,
    bus,
    spawnPointId,
    pathPoints = null,
    waveType = "NORMAL",
    armorType = "none",
    leakDamage = 1,
    bossMeta = null,
    affix = null,
    specialEffects = null,
  }) {
    this.id = id;
    this.speed = speed;
    this.baseSpeed = speed;
    this.hp = hp;
    this.armor = armor;
    this.baseArmor = armor;
    this.waveType = waveType;
    this.armorType = String(armorType ?? "none").toLowerCase();
    this.pathMap = pathMap;
    this.bus = bus;

    const spawn =
      this.pathMap.getSpawnPoint(spawnPointId) ?? this.pathMap.getSpawnPoints()[0] ?? null;
    if (!spawn) {
      throw new Error("No spawn point available for creep spawn.");
    }

    this.routeId = spawn.routeId;
    this.position = { x: spawn.x, y: spawn.y };
    this.pathPoints = Array.isArray(pathPoints) && pathPoints.length >= 2
      ? pathPoints.map((point) => ({ x: point.x, y: point.y }))
      : null;
    this.pathIndex = 0;
    this.maxHp = hp;
    this.currentHp = hp;
    this.alive = true;
    this.destroyed = false;
    this.destroyReason = null;
    this.leakDamage = Math.max(1, Math.floor(leakDamage));
    this.bossMeta = bossMeta;
    this.bossPhase = 1;
    this.affix = affix;
    this.specialEffects = specialEffects ?? {};
    this.burnStacks = 0;
    this.burnTickTimer = 1;
    this.poisonStacks = 0;
    this.poisonTickTimer = 1;
    this.freezeTimer = 0;
    this.iceSlowTimer = 0;
    this.iceSlowMul = 0.5;
    this.poisonSlowTimer = 0;
    this.poisonSlowMul = 0.75;
    this.stunTimer = 0;
    this.auraMoveMul = 1;
    this.auraArmorReduction = 0;
    this.webGrounded = false;
    this.boostActive = false;
    this.auraEffectDetails = [];
    this.auraAffected = false;
    this.auraRevealed = false;
    this.isInvisible = !!this.specialEffects.invisible;
    this.revealedTimer = 0;
    this.magicImmune = !!this.specialEffects.magicImmune;
    this.spellResistance = !!this.specialEffects.spellResistance;
    this.regenerationRatio = Math.max(0, this.specialEffects.regenerationRatio ?? 0);
    this.hasSecondChance = !!this.specialEffects.secondChance;
    this.hasEvolving = !!this.specialEffects.evolving;
    this.usedSecondChance = false;
    this.usedEvolving = false;
    this.bountyMultiplier = this.specialEffects.rich ? 1.5 : 1;
    this.shieldMaxHp = this.specialEffects.protector ? Math.floor(this.maxHp * 0.25) : 0;
    this.shieldHp = this.shieldMaxHp;
    this.shieldRespawnDelay = this.specialEffects.protector ? 13 : 0;
    this.shieldRespawnTimer = 0;
    this.hasSlowAura = !!this.specialEffects.slowAura;
    this.slowAuraRadius = this.hasSlowAura ? 40 : 0;
  }

  _rollEvolvingPower() {
    const roll = Math.random();
    if (roll < 0.01) {
      return "protector";
    }

    const pool = [
      "invisible",
      "speed",
      "greater speed",
      "strong",
      "armored",
      "heavy armored",
      "slow aura",
      "regeneration",
      "magic immunity",
      "air",
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _applyEvolvingPower(power) {
    switch (power) {
      case "invisible":
        this.isInvisible = true;
        break;
      case "speed":
        this.speed *= 1.3;
        break;
      case "greater speed":
        this.speed *= 1.6;
        break;
      case "strong":
        this.maxHp = Math.floor(this.maxHp * 1.2);
        this.currentHp = Math.floor(this.currentHp * 1.2);
        break;
      case "armored":
        this.armor += 4;
        break;
      case "heavy armored":
        this.armor += 9;
        break;
      case "slow aura":
        this.hasSlowAura = true;
        this.slowAuraRadius = 40;
        break;
      case "regeneration":
        this.regenerationRatio = Math.max(this.regenerationRatio, 0.01);
        break;
      case "magic immunity":
        this.magicImmune = true;
        break;
      case "air":
        this.waveType = "AIR";
        break;
      case "protector":
        this.shieldMaxHp = Math.max(this.shieldMaxHp, Math.floor(this.maxHp * 0.25));
        this.shieldHp = this.shieldMaxHp;
        this.shieldRespawnDelay = 13;
        this.shieldRespawnTimer = 0;
        break;
      default:
        break;
    }
  }

  update(dt) {
    if (!this.alive) {
      return;
    }

    const controlDecay = this.boostActive ? 0.5 : 1;

    if (this.burnStacks > 0) {
      this.burnTickTimer -= dt;
      while (this.alive && this.burnTickTimer <= 0) {
        const burnDamage = this.burnStacks * (this.boostActive ? 2 : 1);
        this.takeDamage(burnDamage, null, "burn", { ignoreArmor: true });
        this.burnTickTimer += 1;
      }
    }

    if (this.poisonStacks > 0) {
      this.poisonTickTimer -= dt;
      while (this.alive && this.poisonTickTimer <= 0) {
        const poisonDamage = this.poisonStacks * (this.boostActive ? 2 : 1);
        this.takeDamage(poisonDamage, null, "poison", { ignoreArmor: true });
        this.poisonTickTimer += 1;
      }
    }

    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt * controlDecay);
    }
    if (this.revealedTimer > 0) {
      this.revealedTimer = Math.max(0, this.revealedTimer - dt);
    }
    if (this.iceSlowTimer > 0) {
      this.iceSlowTimer = Math.max(0, this.iceSlowTimer - dt);
    }
    if (this.poisonSlowTimer > 0) {
      this.poisonSlowTimer = Math.max(0, this.poisonSlowTimer - dt);
    }
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt * controlDecay);
    }
    if (this.shieldRespawnTimer > 0) {
      this.shieldRespawnTimer = Math.max(0, this.shieldRespawnTimer - dt);
      if (this.shieldRespawnTimer <= 0 && this.alive && this.shieldMaxHp > 0) {
        this.shieldHp = this.shieldMaxHp;
      }
    }
    if (this.regenerationRatio > 0 && this.alive) {
      this.heal(this.maxHp * this.regenerationRatio * dt);
    }

    if (this.freezeTimer > 0 || this.stunTimer > 0) {
      return;
    }

    const target = this.pathPoints
      ? (this.pathPoints[this.pathIndex + 1] ?? null)
      : this.pathMap.getNextPoint(this.routeId, this.pathIndex);
    if (!target) {
      this.alive = false;
      this.bus.emit("creep:reached-end", { id: this.id, leakDamage: this.leakDamage });
      return;
    }

    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.001) {
      this.pathIndex += 1;
      return;
    }

    const move = this.speed * this.getSpeedMultiplier() * dt;
    if (move >= distance) {
      this.position.x = target.x;
      this.position.y = target.y;
      this.pathIndex += 1;
      return;
    }

    this.position.x += (dx / distance) * move;
    this.position.y += (dy / distance) * move;
  }

  takeDamage(amount, sourceTowerId, damageType = "physical", options = {}) {
    if (!this.alive) {
      return 0;
    }

    if (this.armorType === "life" && (damageType === "burn" || damageType === "poison")) {
      return 0;
    }

    if (this.magicImmune && damageType === "magic") {
      return 0;
    }

    let armorFactor = 1;
    if (options.ignoreArmor) {
      armorFactor = 1;
    } else if (damageType === "piercing" || damageType === "bludgeoning" || damageType === "chaos") {
      armorFactor = 100 / (100 + this.getEffectiveArmor() * 6);
    } else if (damageType === "magic") {
      armorFactor = 100 / (100 + this.getEffectiveArmor() * 3.5);
    }

    let armorTypeFactor = 1;
    if (damageType === "piercing") {
      if (this.armorType === "light") {
        armorTypeFactor *= 1.2;
      } else if (this.armorType === "heavy") {
        armorTypeFactor *= 0.25;
      }
    }
    if (["piercing", "bludgeoning", "magic"].includes(damageType) && this.armorType === "divin") {
      armorTypeFactor *= 0.35;
    }
    if (damageType === "chaos") {
      armorTypeFactor *= this.armorType === "divin" ? 1 : 0.8;
    }
    if (damageType === "magic" && this.spellResistance) {
      armorTypeFactor *= 0.5;
    }
    if (damageType === "laser") {
      if (this.armorType === "divin" || this.armorType === "heavy") {
        armorTypeFactor *= 1.25;
      } else if (this.armorType === "light") {
        armorTypeFactor *= 0.85;
      } else if (this.armorType === "immune") {
        armorTypeFactor *= 0.5;
      }
    }

    let dealt = Math.max(0, amount * armorFactor * armorTypeFactor);

    if (this.shieldHp > 0) {
      const shieldDamage = Math.min(this.shieldHp, dealt);
      this.shieldHp -= shieldDamage;
      dealt -= shieldDamage;
      if (this.shieldHp <= 0 && this.shieldMaxHp > 0) {
        this.shieldHp = 0;
        this.shieldRespawnTimer = this.shieldRespawnDelay;
      }
    }

    this.currentHp -= dealt;

    this._updateBossPhase();

    this.bus.emit("creep:damaged", {
      id: this.id,
      sourceTowerId,
      dealt,
      hp: this.currentHp,
      maxHp: this.maxHp,
    });

    if (this.currentHp <= 0) {
      if (this.hasSecondChance && !this.usedSecondChance) {
        this.usedSecondChance = true;
        this.currentHp = Math.max(1, Math.floor(this.maxHp * 0.8));
        this.shieldHp = this.shieldMaxHp;
        this.shieldRespawnTimer = 0;
        return dealt;
      }
      if (this.hasEvolving && !this.usedEvolving) {
        this.usedEvolving = true;
        this.currentHp = Math.max(1, Math.floor(this.maxHp * 0.8));
        this.shieldHp = this.shieldMaxHp;
        this.shieldRespawnTimer = 0;
        this._applyEvolvingPower(this._rollEvolvingPower());
        return dealt;
      }
      this.alive = false;
      this.bus.emit("creep:killed", { id: this.id, sourceTowerId });
    }

    return dealt;
  }

  isAlive() {
    return this.alive;
  }

  reveal(duration = 0.25) {
    if (!this.alive || duration <= 0) {
      return;
    }
    this.revealedTimer = Math.max(this.revealedTimer, duration);
  }

  isRevealed() {
    return this.revealedTimer > 0;
  }

  heal(amount) {
    if (!this.alive || amount <= 0) {
      return;
    }
    this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
  }

  addBurnStacks(stacks = 1) {
    if (!this.alive || stacks <= 0) {
      return;
    }

    if (this.armorType === "life") {
      return;
    }

    if (this.iceSlowTimer > 0) {
      this.iceSlowTimer = 0;
    }

    this.burnStacks += Math.floor(stacks);
  }

  reduceBurnStacks(amount = 0) {
    if (amount <= 0) {
      return;
    }
    this.burnStacks = Math.max(0, this.burnStacks - Math.floor(amount));
  }

  applyFreezeOrBurnReduction({ duration = 1, burnReduction = 0 } = {}) {
    if (!this.alive) {
      return;
    }

    if (this.burnStacks > 0) {
      this.reduceBurnStacks(burnReduction);
      return;
    }

    this.freezeTimer = Math.max(this.freezeTimer, duration);
  }

  applyIceSlowOrBurnReduction({ duration = 5, slowMul = 0.5, burnReduction = 0 } = {}) {
    if (!this.alive) {
      return;
    }

    if (this.burnStacks > 0) {
      this.reduceBurnStacks(burnReduction);
      return;
    }

    this.iceSlowTimer = Math.max(this.iceSlowTimer, duration);
    this.iceSlowMul = Math.min(this.iceSlowMul, slowMul);
  }

  applyPoison({ stacks = 1, slowDuration = 20, slowMul = 0.75 } = {}) {
    if (!this.alive || stacks <= 0) {
      return;
    }

    if (this.armorType === "life") {
      return;
    }

    this.poisonStacks += Math.floor(stacks);
    this.poisonSlowTimer = Math.max(this.poisonSlowTimer, slowDuration);
    this.poisonSlowMul = Math.min(this.poisonSlowMul, slowMul);
  }

  applyStun(duration = 1) {
    if (!this.alive || duration <= 0) {
      return;
    }
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  resetAuraEffects() {
    this.auraMoveMul = 1;
    this.auraArmorReduction = 0;
    this.webGrounded = false;
    this.boostActive = false;
    this.auraEffectDetails = [];
    this.auraAffected = false;
    this.auraRevealed = false;
  }

  applyAuraSlow(moveMul = 1, detail = null) {
    this.auraMoveMul *= Math.max(0.1, Math.min(1, moveMul));
    if (detail) {
      this.auraEffectDetails.push(String(detail));
    }
    this.auraAffected = true;
  }

  applyAuraArmorReduction(amount = 0, detail = null) {
    this.auraArmorReduction = Math.max(this.auraArmorReduction, Math.max(0, Math.floor(amount)));
    if (detail) {
      this.auraEffectDetails.push(String(detail));
    }
    this.auraAffected = true;
  }

  applyWebGrounding(detail = null) {
    this.webGrounded = true;
    if (detail) {
      this.auraEffectDetails.push(String(detail));
    }
    this.auraAffected = true;
  }

  applyBoostAura(detail = null) {
    this.boostActive = true;
    if (detail) {
      this.auraEffectDetails.push(String(detail));
    }
    this.auraAffected = true;
  }

  applyAuraReveal(detail = null) {
    this.auraRevealed = true;
    if (detail) {
      this.auraEffectDetails.push(String(detail));
    }
    this.auraAffected = true;
  }

  getEffectiveArmor() {
    return Math.round((this.armor ?? 0) - (this.auraArmorReduction ?? 0));
  }

  getSpeedMultiplier() {
    let mul = this.armorType === "light" ? 1.3 : 1;
    if (this.iceSlowTimer > 0) {
      mul *= this.boostActive ? Math.min(this.iceSlowMul, 0.35) : this.iceSlowMul;
    }
    if (this.poisonSlowTimer > 0) {
      mul *= this.boostActive ? Math.min(this.poisonSlowMul, 0.35) : this.poisonSlowMul;
    }
    mul *= this.auraMoveMul;
    return mul;
  }

  getEffectiveSpeed() {
    if (this.freezeTimer > 0 || this.stunTimer > 0) {
      return 0;
    }
    return this.speed * this.getSpeedMultiplier();
  }

  _updateBossPhase() {
    if (!this.bossMeta || !Array.isArray(this.bossMeta.thresholds)) {
      return;
    }

    const hpRatio = this.maxHp > 0 ? this.currentHp / this.maxHp : 0;
    const thresholds = this.bossMeta.thresholds;

    let nextPhase = 1;
    if (hpRatio <= thresholds[1]) {
      nextPhase = 3;
    } else if (hpRatio <= thresholds[0]) {
      nextPhase = 2;
    }

    if (nextPhase !== this.bossPhase) {
      this.bossPhase = nextPhase;
      this.bus.emit("boss:phase-changed", {
        id: this.id,
        phase: this.bossPhase,
        hpRatio,
      });
    }
  }

  toSnapshot() {
    return {
      id: this.id,
      speed: this.speed,
      baseSpeed: this.baseSpeed,
      hp: this.hp,
      armor: this.armor,
      baseArmor: this.baseArmor,
      routeId: this.routeId,
      position: { ...this.position },
      pathPoints: this.pathPoints ? this.pathPoints.map((point) => ({ ...point })) : null,
      pathIndex: this.pathIndex,
      maxHp: this.maxHp,
      currentHp: this.currentHp,
      alive: this.alive,
      leakDamage: this.leakDamage,
      waveType: this.waveType,
      armorType: this.armorType,
      bossMeta: this.bossMeta,
      bossPhase: this.bossPhase,
      affix: this.affix,
      specialEffects: this.specialEffects,
      burnStacks: this.burnStacks,
      burnTickTimer: this.burnTickTimer,
      poisonStacks: this.poisonStacks,
      poisonTickTimer: this.poisonTickTimer,
      freezeTimer: this.freezeTimer,
      iceSlowTimer: this.iceSlowTimer,
      iceSlowMul: this.iceSlowMul,
      poisonSlowTimer: this.poisonSlowTimer,
      poisonSlowMul: this.poisonSlowMul,
      stunTimer: this.stunTimer,
      auraMoveMul: this.auraMoveMul,
      auraArmorReduction: this.auraArmorReduction,
      webGrounded: this.webGrounded,
      boostActive: this.boostActive,
      auraEffectDetails: [...this.auraEffectDetails],
      auraAffected: this.auraAffected,
      auraRevealed: this.auraRevealed,
      isInvisible: this.isInvisible,
      revealedTimer: this.revealedTimer,
      magicImmune: this.magicImmune,
      spellResistance: this.spellResistance,
      regenerationRatio: this.regenerationRatio,
      hasSecondChance: this.hasSecondChance,
      hasEvolving: this.hasEvolving,
      usedSecondChance: this.usedSecondChance,
      usedEvolving: this.usedEvolving,
      bountyMultiplier: this.bountyMultiplier,
      shieldMaxHp: this.shieldMaxHp,
      shieldHp: this.shieldHp,
      shieldRespawnDelay: this.shieldRespawnDelay,
      shieldRespawnTimer: this.shieldRespawnTimer,
      hasSlowAura: this.hasSlowAura,
      slowAuraRadius: this.slowAuraRadius,
      waveLevel: this.waveLevel,
      plannedDropItem: this.plannedDropItem ?? null,
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }
    this.speed = Number.isFinite(snapshot.speed) ? snapshot.speed : this.speed;
    this.baseSpeed = Number.isFinite(snapshot.baseSpeed) ? snapshot.baseSpeed : this.baseSpeed;
    this.hp = Number.isFinite(snapshot.hp) ? snapshot.hp : this.hp;
    this.armor = Number.isFinite(snapshot.armor) ? snapshot.armor : this.armor;
    this.baseArmor = Number.isFinite(snapshot.baseArmor) ? snapshot.baseArmor : this.baseArmor;
    this.routeId = snapshot.routeId ?? this.routeId;
    this.position = {
      x: Number.isFinite(snapshot.position?.x) ? snapshot.position.x : this.position.x,
      y: Number.isFinite(snapshot.position?.y) ? snapshot.position.y : this.position.y,
    };
    this.pathPoints = Array.isArray(snapshot.pathPoints)
      ? snapshot.pathPoints.map((point) => ({ x: point.x, y: point.y }))
      : this.pathPoints;
    this.pathIndex = Number.isFinite(snapshot.pathIndex) ? snapshot.pathIndex : this.pathIndex;
    this.maxHp = Number.isFinite(snapshot.maxHp) ? snapshot.maxHp : this.maxHp;
    this.currentHp = Number.isFinite(snapshot.currentHp) ? snapshot.currentHp : this.currentHp;
    this.alive = snapshot.alive !== false;
    this.leakDamage = Number.isFinite(snapshot.leakDamage) ? snapshot.leakDamage : this.leakDamage;
    this.waveType = snapshot.waveType ?? this.waveType;
    this.armorType = snapshot.armorType ?? this.armorType;
    this.bossMeta = snapshot.bossMeta ?? this.bossMeta;
    this.bossPhase = Number.isFinite(snapshot.bossPhase) ? snapshot.bossPhase : this.bossPhase;
    this.affix = snapshot.affix ?? this.affix;
    this.specialEffects = snapshot.specialEffects ?? this.specialEffects;
    this.burnStacks = Number.isFinite(snapshot.burnStacks) ? snapshot.burnStacks : this.burnStacks;
    this.burnTickTimer = Number.isFinite(snapshot.burnTickTimer) ? snapshot.burnTickTimer : this.burnTickTimer;
    this.poisonStacks = Number.isFinite(snapshot.poisonStacks) ? snapshot.poisonStacks : this.poisonStacks;
    this.poisonTickTimer = Number.isFinite(snapshot.poisonTickTimer) ? snapshot.poisonTickTimer : this.poisonTickTimer;
    this.freezeTimer = Number.isFinite(snapshot.freezeTimer) ? snapshot.freezeTimer : this.freezeTimer;
    this.iceSlowTimer = Number.isFinite(snapshot.iceSlowTimer) ? snapshot.iceSlowTimer : this.iceSlowTimer;
    this.iceSlowMul = Number.isFinite(snapshot.iceSlowMul) ? snapshot.iceSlowMul : this.iceSlowMul;
    this.poisonSlowTimer = Number.isFinite(snapshot.poisonSlowTimer) ? snapshot.poisonSlowTimer : this.poisonSlowTimer;
    this.poisonSlowMul = Number.isFinite(snapshot.poisonSlowMul) ? snapshot.poisonSlowMul : this.poisonSlowMul;
    this.stunTimer = Number.isFinite(snapshot.stunTimer) ? snapshot.stunTimer : this.stunTimer;
    this.auraMoveMul = Number.isFinite(snapshot.auraMoveMul) ? snapshot.auraMoveMul : this.auraMoveMul;
    this.auraArmorReduction = Number.isFinite(snapshot.auraArmorReduction) ? snapshot.auraArmorReduction : this.auraArmorReduction;
    this.webGrounded = !!snapshot.webGrounded;
    this.boostActive = !!snapshot.boostActive;
    this.auraEffectDetails = Array.isArray(snapshot.auraEffectDetails) ? [...snapshot.auraEffectDetails] : this.auraEffectDetails;
    this.auraAffected = !!snapshot.auraAffected;
    this.auraRevealed = !!snapshot.auraRevealed;
    this.isInvisible = !!snapshot.isInvisible;
    this.revealedTimer = Number.isFinite(snapshot.revealedTimer) ? snapshot.revealedTimer : this.revealedTimer;
    this.magicImmune = !!snapshot.magicImmune;
    this.spellResistance = !!snapshot.spellResistance;
    this.regenerationRatio = Number.isFinite(snapshot.regenerationRatio) ? snapshot.regenerationRatio : this.regenerationRatio;
    this.hasSecondChance = !!snapshot.hasSecondChance;
    this.hasEvolving = !!snapshot.hasEvolving;
    this.usedSecondChance = !!snapshot.usedSecondChance;
    this.usedEvolving = !!snapshot.usedEvolving;
    this.bountyMultiplier = Number.isFinite(snapshot.bountyMultiplier) ? snapshot.bountyMultiplier : this.bountyMultiplier;
    this.shieldMaxHp = Number.isFinite(snapshot.shieldMaxHp) ? snapshot.shieldMaxHp : this.shieldMaxHp;
    this.shieldHp = Number.isFinite(snapshot.shieldHp) ? snapshot.shieldHp : this.shieldHp;
    this.shieldRespawnDelay = Number.isFinite(snapshot.shieldRespawnDelay) ? snapshot.shieldRespawnDelay : this.shieldRespawnDelay;
    this.shieldRespawnTimer = Number.isFinite(snapshot.shieldRespawnTimer) ? snapshot.shieldRespawnTimer : this.shieldRespawnTimer;
    this.hasSlowAura = !!snapshot.hasSlowAura;
    this.slowAuraRadius = Number.isFinite(snapshot.slowAuraRadius) ? snapshot.slowAuraRadius : this.slowAuraRadius;
    this.waveLevel = Number.isFinite(snapshot.waveLevel) ? snapshot.waveLevel : this.waveLevel;
    this.plannedDropItem = snapshot.plannedDropItem ?? this.plannedDropItem;
  }
}
