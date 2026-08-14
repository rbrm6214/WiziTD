function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const AURA_EFFECTS = ["power", "speed", "range", "slow", "reveal", "web", "chaos", "noarmor", "boost", "reduce", "cresus"];
const AURA_RANGE_EFFECTS = new Set(["reveal", "web", "chaos", "boost"]);

export class Tower {
  constructor({
    id,
    x,
    y,
    baseCost = 0,
    range = 260,
    damage = 45,
    attackCd = 0.7,
    damageType = "physical",
    bonusDamageType = null,
    color = "#93c5fd",
    blueprintId = "sentinel",
    minAttackCd = 0.25,
    xpBase = 40,
    xpGrowth = 1.42,
    upgradeConfig = {},
    specialText = "Standard",
    bonusSpecialText = null,
    hitsAllInRange = false,
    maxTargetsPerShot = null,
    bonusMaxTargetsPerShot = null,
    burnOnHit = 0,
    splashRadius = 0,
    freezeDuration = 0,
    bonusFreezeDuration = null,
    iceSlowDuration = 0,
    iceSlowMul = 0.5,
    burnReductionOnFreezeHit = 0,
    burnReductionOnFreezeSplash = 0,
    poisonOnHit = 0,
    poisonSlowDuration = 0,
    poisonSlowMul = 0.75,
    splashDamageRatio = 0,
    targetGroundOnly = false,
    targetAirOnly = false,
    maxLevelStunChance = 0,
    stunDuration = 0,
    ricochetByLevel = false,
    ricochetRadius = 0,
    ricochetDamageRatio = 0.5,
    ricochetMaxLevelBonus = 0,
    maxLevelMultiShot = 1,
    hasEyes = false,
    revealInvisible = false,
    bonusLevelThreshold = 10,
    maxLevel = 10,
    startLevel = 1,
    itemSlots = 2,
    isAuraTower = false,
    footprintWidth = 1,
    footprintHeight = 1,
    initialAuraEffect = "power",
    investedGold = null,
    bus,
  }) {
    this.id = id;
    this.position = { x, y };
    this.baseCost = Math.max(0, Math.floor(baseCost));
    this.baseRange = range;
    this.baseDamage = damage;
    this.baseAttackCd = attackCd;
    this.range = range;
    this.damage = damage;
    this.attackCd = attackCd;
    this.baseDamageType = damageType;
    this.bonusDamageType = bonusDamageType;
    this.damageType = damageType;
    this.color = color;
    this.blueprintId = blueprintId;
    this.isAuraTower = !!isAuraTower;
    this.footprintWidth = Math.max(1, Math.floor(footprintWidth));
    this.footprintHeight = Math.max(1, Math.floor(footprintHeight));
    this.selectedAuraEffect = AURA_EFFECTS.includes(String(initialAuraEffect ?? "").toLowerCase())
      ? String(initialAuraEffect).toLowerCase()
      : "power";
    this.minAttackCd = minAttackCd;
    this.xpBase = xpBase;
    this.xpGrowth = xpGrowth;
    this.specialText = specialText;
    this.bonusSpecialText = bonusSpecialText;
    this.hitsAllInRange = hitsAllInRange;
    this.maxTargetsPerShot = Number.isFinite(maxTargetsPerShot) ? Math.max(1, Math.floor(maxTargetsPerShot)) : null;
    this.bonusMaxTargetsPerShot = Number.isFinite(bonusMaxTargetsPerShot)
      ? Math.max(1, Math.floor(bonusMaxTargetsPerShot))
      : null;
    this.burnOnHit = Math.max(0, Math.floor(burnOnHit));
    this.splashRadius = Math.max(0, splashRadius);
    this.freezeDuration = Math.max(0, freezeDuration);
    this.bonusFreezeDuration = Number.isFinite(bonusFreezeDuration) ? Math.max(0, Math.floor(bonusFreezeDuration)) : null;
    this.iceSlowDuration = Math.max(0, iceSlowDuration);
    this.iceSlowMul = Math.max(0.1, Math.min(1, iceSlowMul));
    this.burnReductionOnFreezeHit = Math.max(0, Math.floor(burnReductionOnFreezeHit));
    this.burnReductionOnFreezeSplash = Math.max(0, Math.floor(burnReductionOnFreezeSplash));
    this.poisonOnHit = Math.max(0, Math.floor(poisonOnHit));
    this.poisonSlowDuration = Math.max(0, poisonSlowDuration);
    this.poisonSlowMul = Math.max(0.1, Math.min(1, poisonSlowMul));
    this.splashDamageRatio = Math.max(0, Math.min(1, splashDamageRatio));
    this.targetGroundOnly = !!targetGroundOnly;
    this.targetAirOnly = !!targetAirOnly;
    this.maxLevelStunChance = Math.max(0, Math.min(1, maxLevelStunChance));
    this.stunDuration = Math.max(0, stunDuration);
    this.ricochetByLevel = !!ricochetByLevel;
    this.ricochetRadius = Math.max(0, ricochetRadius);
    this.ricochetDamageRatio = Math.max(0, Math.min(1, ricochetDamageRatio));
    this.ricochetMaxLevelBonus = Math.max(0, Math.floor(ricochetMaxLevelBonus));
    this.maxLevelMultiShot = Math.max(1, Math.floor(maxLevelMultiShot));
    this.hasEyes = !!hasEyes;
    this.revealInvisible = !!revealInvisible;
    this.bonusLevelThreshold = Math.max(1, Math.floor(bonusLevelThreshold));
    this.upgradeConfig = {
      damageMul: upgradeConfig.damageMul ?? 1.3,
      damageFlat: upgradeConfig.damageFlat ?? 6,
      rangeFlat: upgradeConfig.rangeFlat ?? 10,
      attackCdMul: upgradeConfig.attackCdMul ?? 0.95,
    };
    this.bus = bus;
    this.cooldown = 0;
    this.level = Math.max(0, Math.floor(startLevel));
    this.maxLevel = Math.max(this.bonusLevelThreshold, Math.floor(maxLevel));
    this.xp = 0;
    this.investedGold = Math.max(0, Math.floor(investedGold ?? this.baseCost));
    this.padIds = [];

    this.itemSlots = Math.max(0, Math.floor(itemSlots));
    this.items = [];

    this.itemDamageMul = 1;
    this.itemRangeFlat = 0;
    this.itemAttackSpeedMul = 1;
    this.runDamageMul = 1;
    this.runRangeMul = 1;
    this.runAttackSpeedMul = 1;

    this.auraDamageMul = 1;
    this.auraAttackSpeedMul = 1;
    this.auraRangeMul = 1;
    this.creepAuraAttackSpeedMul = 1;
    this.auraChaosEnabled = false;
    this.auraEffectDetails = [];
    this.auraAffected = false;

    this.autocastTimer = 0;
    this.bossDebuffTimer = 0;
    this.bossDebuffAttackSpeedMul = 1;
    this.targetMode = "avance";

    this._recalculateEffectiveStats();
  }

  getSpecialTextAtLevel(level = this.level) {
    if (this.isAuraTower) {
      return `effet(${this.selectedAuraEffect})${level <= 0 ? ", inactif" : ""}`;
    }
    if (this.ricochetByLevel) {
      return `bounce(${this.getRicochetCountAtLevel(level)}), bludgeoning`;
    }
    if (this.maxLevelStunChance > 0 && level >= this.bonusLevelThreshold) {
      return `${this.specialText ?? "Standard"}, stun(15)`;
    }
    if (this.maxLevelMultiShot > 1 && level >= this.bonusLevelThreshold) {
      return `${this.specialText ?? "Standard"}, multiShot(${this.maxLevelMultiShot})`;
    }
    if (level >= this.bonusLevelThreshold && this.bonusSpecialText) {
      return this.bonusSpecialText;
    }
    return this.specialText ?? "Standard";
  }

  getSpecialText() {
    return this.getSpecialTextAtLevel(this.level);
  }

  getDamageTypeAtLevel(level = this.level) {
    if (this.isAuraTower) {
      return "support";
    }
    if (level >= this.bonusLevelThreshold && this.bonusDamageType) {
      return this.bonusDamageType;
    }
    return this.baseDamageType;
  }

  getCurrentDamageType() {
    if (this.auraChaosEnabled && !this.isAuraTower) {
      return "chaos";
    }
    return this.getDamageTypeAtLevel(this.level);
  }

  isAuraEffectRangeScaled(effect = this.selectedAuraEffect) {
    return AURA_RANGE_EFFECTS.has(String(effect ?? "").toLowerCase());
  }

  getAuraRangeAtLevel(level = this.level, effect = this.selectedAuraEffect) {
    if (!this.isAuraTower) {
      return this.baseRange;
    }
    if (!this.isAuraEffectRangeScaled(effect)) {
      return level >= 10 ? Math.max(1, Math.floor(this.baseRange * 1.1)) : this.baseRange;
    }
    const growthSteps = Math.max(0, Math.floor(level) - 1);
    const scaledBase = level >= 10 ? this.baseRange * 1.1 : this.baseRange;
    return Math.max(1, Math.floor(scaledBase * (1 + growthSteps * 0.02)));
  }

  canChangeAuraEffect() {
    return this.isAuraTower && this.level <= 0;
  }

  setAuraEffect(effect) {
    const normalized = String(effect ?? "").toLowerCase();
    if (!this.canChangeAuraEffect() || !AURA_EFFECTS.includes(normalized)) {
      return false;
    }
    this.selectedAuraEffect = normalized;
    this._recalculateEffectiveStats();
    return true;
  }

  getMaxTargetsPerShotAtLevel(level = this.level) {
    if (level >= this.bonusLevelThreshold && this.bonusMaxTargetsPerShot) {
      return this.bonusMaxTargetsPerShot;
    }
    return this.maxTargetsPerShot;
  }

  getCurrentMaxTargetsPerShot() {
    return this.getMaxTargetsPerShotAtLevel(this.level);
  }

  getFreezeDurationAtLevel(level = this.level) {
    if (level >= this.bonusLevelThreshold && this.bonusFreezeDuration !== null) {
      return this.bonusFreezeDuration;
    }
    return this.freezeDuration;
  }

  getCurrentFreezeDuration() {
    return this.getFreezeDurationAtLevel(this.level);
  }

  getRicochetCountAtLevel(level = this.level) {
    if (!this.ricochetByLevel) {
      return 0;
    }
    if (level >= this.bonusLevelThreshold) {
      return Math.min(15, level + this.ricochetMaxLevelBonus);
    }
    return Math.min(15, level);
  }

  getRicochetCount() {
    return this.getRicochetCountAtLevel(this.level);
  }

  hasReachedBonusLevel() {
    return this.level >= this.bonusLevelThreshold;
  }

  setRunBonuses({
    damageMul = 1,
    rangeMul = 1,
    attackSpeedMul = 1,
    maxLevel = this.maxLevel,
    revealInvisible = this.revealInvisible,
  } = {}) {
    this.runDamageMul = Math.max(0.1, damageMul);
    this.runRangeMul = Math.max(0.1, rangeMul);
    this.runAttackSpeedMul = Math.max(0.1, attackSpeedMul);
    this.maxLevel = Math.max(this.bonusLevelThreshold, Math.floor(maxLevel));
    this.revealInvisible = !!revealInvisible;
    this._recalculateEffectiveStats();
  }

  _isAirTarget(creep) {
    const waveType = String(creep?.waveType ?? "").toUpperCase();
    return waveType === "AIR" && !creep?.webGrounded;
  }

  _canTargetCreep(creep) {
    if (!creep?.isAlive?.()) {
      return false;
    }
    if (this.targetGroundOnly && this._isAirTarget(creep)) {
      return false;
    }
    if (this.targetAirOnly && !this._isAirTarget(creep)) {
      return false;
    }
    if (creep.isInvisible && !this.hasEyes && !this.revealInvisible && !creep.isRevealed?.()) {
      return false;
    }
    if (this.damageType === "magic" && (creep.armorType === "immune" || creep.magicImmune)) {
      return false;
    }
    return true;
  }

  _findClosestAliveCandidate(baseCreep, creeps, radiusSq) {
    let nearest = null;
    let nearestDistSq = Number.POSITIVE_INFINITY;

    for (const creep of creeps) {
      if (!creep?.isAlive?.()) {
        continue;
      }
      if (creep.id === baseCreep.id) {
        continue;
      }
      const d = distanceSq(baseCreep.position, creep.position);
      if (d > radiusSq) {
        continue;
      }
      if (d < nearestDistSq) {
        nearestDistSq = d;
        nearest = creep;
      }
    }

    return nearest;
  }

  _applySingleHit(target, amount) {
    if (!target?.isAlive?.()) {
      return 0;
    }

    let dealt = target.takeDamage(amount, this.id, this.damageType);

    if (this.burnOnHit > 0 && target.isAlive()) {
      target.addBurnStacks(this.burnOnHit);
    }

    if (this.poisonOnHit > 0 && target.isAlive()) {
      target.applyPoison({
        stacks: this.poisonOnHit,
        slowDuration: this.poisonSlowDuration,
        slowMul: this.poisonSlowMul,
      });
    }

    const freezeDuration = this.getCurrentFreezeDuration();
    if (freezeDuration > 0 && target.isAlive()) {
      const targetWasBurning = (target.burnStacks ?? 0) > 0;
      target.applyFreezeOrBurnReduction({
        duration: freezeDuration,
        burnReduction: this.burnReductionOnFreezeHit,
      });
      if (!targetWasBurning && this.iceSlowDuration > 0) {
        target.applyIceSlowOrBurnReduction({
          duration: this.iceSlowDuration,
          slowMul: this.iceSlowMul,
          burnReduction: 0,
        });
      }
    } else if (this.iceSlowDuration > 0 && target.isAlive()) {
      target.applyIceSlowOrBurnReduction({
        duration: this.iceSlowDuration,
        slowMul: this.iceSlowMul,
        burnReduction: 0,
      });
    }

    if (this.maxLevelStunChance > 0 && this.stunDuration > 0 && this.level >= this.bonusLevelThreshold && target.isAlive()) {
      if (Math.random() < this.maxLevelStunChance) {
        target.applyStun?.(this.stunDuration);
      }
    }

    return dealt;
  }

  _recalculateEffectiveStats() {
    const previousAttackCd = this.attackCd;
    const previousCooldown = this.cooldown;

    if (this.isAuraTower) {
      this.damageType = "support";
      this.damage = 0;
      this.range = Math.max(
        1,
        Math.floor(this.getAuraRangeAtLevel(this.level, this.selectedAuraEffect) * this.runRangeMul * this.auraRangeMul + this.itemRangeFlat),
      );
      this.attackCd = Number.POSITIVE_INFINITY;
      return;
    }

    this.damageType = this.getCurrentDamageType();
    this.damage = Math.max(
      1,
      Math.floor(this.baseDamage * this.itemDamageMul * this.auraDamageMul * this.runDamageMul),
    );
    this.range = Math.max(100, Math.floor(this.baseRange * this.runRangeMul * this.auraRangeMul + this.itemRangeFlat));

    const speedMul = Math.max(
      0.2,
      this.itemAttackSpeedMul
        * this.runAttackSpeedMul
        * this.auraAttackSpeedMul
        * this.bossDebuffAttackSpeedMul
        * this.creepAuraAttackSpeedMul,
    );
    this.attackCd = Math.max(this.minAttackCd, this.baseAttackCd / speedMul);

    if (
      Number.isFinite(previousAttackCd)
      && previousAttackCd > 0
      && Number.isFinite(previousCooldown)
      && previousCooldown > 0
      && Number.isFinite(this.attackCd)
      && this.attackCd > 0
    ) {
      const progress = Math.max(0, Math.min(1, 1 - previousCooldown / previousAttackCd));
      this.cooldown = Math.max(0, this.attackCd * (1 - progress));
    }
  }

  getDamageBeforeAura() {
    return Math.max(1, Math.floor(this.baseDamage * this.itemDamageMul * this.runDamageMul));
  }

  getRangeBeforeAura() {
    return Math.max(100, Math.floor(this.baseRange * this.runRangeMul + this.itemRangeFlat));
  }

  getAttackCdBeforeAura() {
    const speedMul = Math.max(
      0.2,
      this.itemAttackSpeedMul * this.runAttackSpeedMul * this.bossDebuffAttackSpeedMul * this.creepAuraAttackSpeedMul,
    );
    return Math.max(this.minAttackCd, this.baseAttackCd / speedMul);
  }

  getDpsBeforeAura() {
    const attackCd = this.getAttackCdBeforeAura();
    return attackCd > 0 && Number.isFinite(attackCd) ? this.getDamageBeforeAura() / attackCd : 0;
  }

  getUpgradeCost() {
    if (this.level >= this.maxLevel) {
      return 0;
    }

    return this.getUpgradeCostAtLevel(this.level);
  }

  getUpgradeCostAtLevel(level) {
    if (level >= this.maxLevel) {
      return 0;
    }

    const base = 95;
    if (level <= 0) {
      return base;
    }
    return Math.floor(base * Math.pow(1.55, level - 1));
  }

  getTotalGoldValue() {
    return this.investedGold;
  }

  addInvestment(amount) {
    this.investedGold += Math.max(0, Math.floor(amount));
  }

  upgrade() {
    if (this.level >= this.maxLevel) {
      return false;
    }

    const preview = this.getUpgradePreview();
    if (!preview) {
      return false;
    }

    this.level += 1;
    if (this.isAuraTower) {
      this._recalculateEffectiveStats();
      return true;
    }
    this.baseDamage = preview.baseDamage;
    this.baseRange = preview.baseRange;
    this.baseAttackCd = preview.baseAttackCd;
    this._recalculateEffectiveStats();
    return true;
  }

  getXpForNextLevel() {
    if (this.level >= this.maxLevel) {
      return 0;
    }

    return Math.floor(this.xpBase * Math.pow(this.xpGrowth, this.level - 1));
  }

  getDps() {
    if (this.isAuraTower || !Number.isFinite(this.attackCd) || this.attackCd <= 0) {
      return 0;
    }
    return this.damage / this.attackCd;
  }

  getBaseDps() {
    return this.baseDamage / this.baseAttackCd;
  }

  getUpgradePreview() {
    if (this.level >= this.maxLevel) {
      return null;
    }

    if (this.isAuraTower) {
      const nextLevel = this.level + 1;
      const nextRange = Math.max(
        1,
        Math.floor(this.getAuraRangeAtLevel(nextLevel, this.selectedAuraEffect) * this.runRangeMul * this.auraRangeMul + this.itemRangeFlat),
      );
      return {
        level: nextLevel,
        baseDamage: 0,
        baseRange: nextRange,
        baseAttackCd: this.baseAttackCd,
        damage: 0,
        range: nextRange,
        attackCd: Number.POSITIVE_INFINITY,
        dps: 0,
        damageType: "support",
        specialText: this.getSpecialTextAtLevel(nextLevel),
      };
    }

    const nextDamage = Math.floor(this.baseDamage * this.upgradeConfig.damageMul + this.upgradeConfig.damageFlat);
    const nextRange = Math.floor(this.baseRange);
    const nextAttackCd = Math.max(this.minAttackCd, this.baseAttackCd * this.upgradeConfig.attackCdMul);

    const projectedDamage = Math.max(
      1,
      Math.floor(nextDamage * this.itemDamageMul * this.auraDamageMul * this.runDamageMul),
    );
    const projectedAttackCd = Math.max(
      this.minAttackCd,
      nextAttackCd / Math.max(0.2, this.itemAttackSpeedMul * this.runAttackSpeedMul * this.auraAttackSpeedMul),
    );

    return {
      level: this.level + 1,
      baseDamage: nextDamage,
      baseRange: nextRange,
      baseAttackCd: nextAttackCd,
      damage: projectedDamage,
      range: Math.floor(nextRange * this.runRangeMul + this.itemRangeFlat),
      attackCd: projectedAttackCd,
      dps: projectedDamage / projectedAttackCd,
      damageType: this.getDamageTypeAtLevel(this.level + 1),
      specialText: this.getSpecialTextAtLevel(this.level + 1),
    };
  }

  canAddItem() {
    return this.items.length < this.itemSlots;
  }

  _rebuildItemBonuses() {
    this.itemDamageMul = 1;
    this.itemRangeFlat = 0;
    this.itemAttackSpeedMul = 1;

    for (const item of this.items) {
      this.itemDamageMul *= item?.modifiers?.damageMul ?? 1;
      this.itemRangeFlat += item?.modifiers?.rangeFlat ?? 0;
      this.itemAttackSpeedMul *= item?.modifiers?.attackSpeedMul ?? 1;
    }

    this._recalculateEffectiveStats();
  }

  addItem(item) {
    if (!this.canAddItem()) {
      return false;
    }

    this.items.push(item);
    this._rebuildItemBonuses();
    return true;
  }

  removeItemAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      return null;
    }

    const [removed] = this.items.splice(index, 1);
    this._rebuildItemBonuses();
    return removed ?? null;
  }

  resetAuraEffects() {
    this.auraDamageMul = 1;
    this.auraAttackSpeedMul = 1;
    this.auraRangeMul = 1;
    this.creepAuraAttackSpeedMul = 1;
    this.auraChaosEnabled = false;
    this.auraEffectDetails = [];
    this.auraAffected = false;
    this._recalculateEffectiveStats();
  }

  applyAuraEffects({ damageMul = 1, attackSpeedMul = 1, rangeMul = 1, forceChaos = false, detail = null, markAura = false } = {}) {
    this.auraDamageMul *= damageMul;
    this.auraAttackSpeedMul *= attackSpeedMul;
    this.auraRangeMul *= Math.max(0.1, rangeMul);
    this.auraChaosEnabled = this.auraChaosEnabled || !!forceChaos;
    if (markAura && detail) {
      this.auraEffectDetails.push(String(detail));
    }
    if (markAura) {
      this.auraAffected = true;
    }
    this._recalculateEffectiveStats();
  }

  applyCreepSlowAura(attackSpeedMul = 0.5) {
    this.creepAuraAttackSpeedMul *= Math.max(0.1, Math.min(1, attackSpeedMul));
    this._recalculateEffectiveStats();
  }

  grantXp(amount) {
    if (this.level >= this.maxLevel || amount <= 0) {
      return false;
    }

    this.xp += amount;
    let leveled = false;

    while (this.level < this.maxLevel) {
      const nextThreshold = this.getXpForNextLevel();
      if (this.xp < nextThreshold) {
        break;
      }

      this.xp -= nextThreshold;
      const upgraded = this.upgrade();
      if (!upgraded) {
        break;
      }
      leveled = true;
    }

    return leveled;
  }

  applyBossDebuff({ duration = 2.2, attackSpeedMul = 0.9 } = {}) {
    this.bossDebuffTimer = Math.max(this.bossDebuffTimer, duration);
    this.bossDebuffAttackSpeedMul = Math.min(this.bossDebuffAttackSpeedMul, attackSpeedMul);
    this._recalculateEffectiveStats();
  }

  setTargetMode(mode) {
    if (this.isAuraTower) {
      return false;
    }
    const allowed = ["proche", "eloigne", "avance", "recule", "faible", "fort", "stop"];
    if (!allowed.includes(mode)) {
      return false;
    }
    this.targetMode = mode;
    return true;
  }

  _compareCandidates(left, right) {
    if (this.targetMode === "proche") {
      return left.distanceSq - right.distanceSq;
    }

    if (this.targetMode === "eloigne") {
      return right.distanceSq - left.distanceSq;
    }

    if (this.targetMode === "avance") {
      if (left.pathIndex !== right.pathIndex) {
        return right.pathIndex - left.pathIndex;
      }
      return left.distanceSq - right.distanceSq;
    }

    if (this.targetMode === "faible") {
      if (left.hp !== right.hp) {
        return left.hp - right.hp;
      }
      if (left.pathIndex !== right.pathIndex) {
        return right.pathIndex - left.pathIndex;
      }
      return left.distanceSq - right.distanceSq;
    }

    if (this.targetMode === "fort") {
      if (left.hp !== right.hp) {
        return right.hp - left.hp;
      }
      if (left.pathIndex !== right.pathIndex) {
        return right.pathIndex - left.pathIndex;
      }
      return left.distanceSq - right.distanceSq;
    }

    if (left.pathIndex !== right.pathIndex) {
      return left.pathIndex - right.pathIndex;
    }
    return right.distanceSq - left.distanceSq;
  }

  _sortCandidates(candidates) {
    return [...candidates].sort((left, right) => this._compareCandidates(left, right));
  }

  update(dt, creeps) {
    if (this.isAuraTower) {
      return;
    }
    if (this.bossDebuffTimer > 0) {
      this.bossDebuffTimer -= dt;
      if (this.bossDebuffTimer <= 0) {
        this.bossDebuffTimer = 0;
        this.bossDebuffAttackSpeedMul = 1;
        this._recalculateEffectiveStats();
      }
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) {
      return;
    }

    if (this.targetMode === "stop") {
      return;
    }

    const rangeSq = this.range * this.range;
    if (this.revealInvisible && this.level >= this.bonusLevelThreshold) {
      for (const creep of creeps) {
        if (!creep?.isAlive?.() || !creep.isInvisible) {
          continue;
        }

        const d = distanceSq(this.position, creep.position);
        if (d <= rangeSq) {
          creep.reveal?.(0.3);
        }
      }
    }

    const candidates = [];

    for (const creep of creeps) {
      if (!this._canTargetCreep(creep)) {
        continue;
      }

      const d = distanceSq(this.position, creep.position);
      if (d <= rangeSq) {
        candidates.push({
          creep,
          distanceSq: d,
          pathIndex: creep.pathIndex,
          hp: creep.currentHp,
        });
      }
    }

    const sortedCandidates = this._sortCandidates(candidates);
    const bestTarget = sortedCandidates[0]?.creep ?? null;

    if (!bestTarget) {
      return;
    }

    let dealt = 0;
    if (this.hitsAllInRange) {
      const maxTargets = this.getCurrentMaxTargetsPerShot() ?? sortedCandidates.length;
      for (const candidate of sortedCandidates.slice(0, maxTargets)) {
        dealt += candidate.creep.takeDamage(this.damage, this.id, this.damageType);
        if (this.burnOnHit > 0 && candidate.creep.isAlive()) {
          candidate.creep.addBurnStacks(this.burnOnHit);
        }
      }
    } else {
      dealt += this._applySingleHit(bestTarget, this.damage);

      if (this.ricochetByLevel) {
        let bounceTarget = bestTarget;
        const bounces = this.getRicochetCount();
        const bounceDamage = Math.max(1, Math.floor(this.damage * this.ricochetDamageRatio));
        const bounceRadiusSq = this.ricochetRadius * this.ricochetRadius;
        for (let i = 0; i < bounces; i += 1) {
          const nextTarget = this._findClosestAliveCandidate(bounceTarget, creeps, bounceRadiusSq) ?? bounceTarget;
          bounceTarget = nextTarget;
          dealt += this._applySingleHit(nextTarget, bounceDamage);
        }
      }

      if (this.maxLevelMultiShot > 1 && this.level >= this.bonusLevelThreshold) {
        const additionalShots = this.maxLevelMultiShot - 1;
        for (let i = 0; i < additionalShots; i += 1) {
          dealt += this._applySingleHit(bestTarget, this.damage);
        }
      }

      if (this.splashRadius > 0 && this.splashDamageRatio > 0) {
        const splashRadiusSq = this.splashRadius * this.splashRadius;
        const splashDamage = Math.max(1, Math.floor(this.damage * this.splashDamageRatio));
        for (const creep of creeps) {
          if (!creep.isAlive() || creep.id === bestTarget.id) {
            continue;
          }
          if (!this._canTargetCreep(creep)) {
            continue;
          }

          const dx = creep.position.x - bestTarget.position.x;
          const dy = creep.position.y - bestTarget.position.y;
          if (dx * dx + dy * dy > splashRadiusSq) {
            continue;
          }

          dealt += creep.takeDamage(splashDamage, this.id, this.damageType);
        }
      }

      if (this.splashRadius > 0 && this.iceSlowDuration > 0) {
        const splashRadiusSq = this.splashRadius * this.splashRadius;
        for (const creep of creeps) {
          if (!creep.isAlive() || creep.id === bestTarget.id) {
            continue;
          }

          const dx = creep.position.x - bestTarget.position.x;
          const dy = creep.position.y - bestTarget.position.y;
          if (dx * dx + dy * dy > splashRadiusSq) {
            continue;
          }

          creep.applyIceSlowOrBurnReduction({
            duration: this.iceSlowDuration,
            slowMul: this.iceSlowMul,
            burnReduction: this.burnReductionOnFreezeSplash,
          });
        }
      }
    }

    this.cooldown = this.attackCd;
    this.bus.emit("tower:attack", {
      towerId: this.id,
      targetId: bestTarget.id,
      damage: dealt,
    });
  }
}
