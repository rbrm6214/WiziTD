import "./styles.css";
import { EventBus } from "./core/eventBus.js";
import { FixedStepLoop } from "./core/fixedStepLoop.js";
import { SeededRandom } from "./core/rng.js";
import { CsvLoader } from "./data/csvLoader.js";
import { DataRegistry } from "./data/dataRegistry.js";
import { sampleTowerCsv } from "./data/sampleData.js";
import { DocumentationLoader } from "./data/documentationLoader.js";
import { DocumentationParser } from "./data/documentationParser.js";
import { DocumentationIngestion } from "./data/documentationIngestion.js";
import { PathMap } from "./world/pathMap.js";
import { Creep } from "./world/creep.js";
import { Tower } from "./world/tower.js";
import { WaveGenerator } from "./game/waveGenerator.js";
import { WaveSpawner } from "./game/waveSpawner.js";
import { createTowerBlueprints } from "./game/towerBlueprintFactory.js";
import { ItemSystem } from "./game/itemSystem.js";
import { AuraSystem } from "./game/auraSystem.js";
import { AutocastSystem } from "./game/autocastSystem.js";
import { createMissionPresets } from "./game/missionSystem.js";
import { WaveModifierSystem } from "./game/waveModifierSystem.js";
import { EliteAffixSystem } from "./game/eliteAffixSystem.js";
import { BossAbilitySystem } from "./game/bossAbilitySystem.js";
import { MetaProgressionSystem } from "./game/metaProgressionSystem.js";
import { SaveProfileSystem } from "./game/saveProfileSystem.js";

const WIDTH = 1280;
const HEIGHT = 720;
const GRID_SIZE = 40;
const PATH_DRAW_WIDTH = 24;
const BUILD_PAD_RADIUS = 14;
const SELL_REFUND_FACTOR = 0.75;
const TARGET_WAVE_VICTORY = 500;
const PRE_WAVE_DURATION_MS = 30000;
const GAME_MODES = ["standard", "triple", "solo"];

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(n));
}

function colorWithAlpha(color, alpha, fallback = "#93c5fd") {
  const value = String(color ?? fallback).trim();
  let hex = value;
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) {
    hex = fallback;
  }

  const clean = hex.slice(1);
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : clean;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );

  const px = start.x + dx * t;
  const py = start.y + dy * t;
  return Math.hypot(point.x - px, point.y - py);
}

function cellTouchesRoute(cellCenter, routePoints) {
  const threshold = GRID_SIZE * 0.5 + PATH_DRAW_WIDTH * 0.5;

  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const start = routePoints[i];
    const end = routePoints[i + 1];
    if (pointToSegmentDistance(cellCenter, start, end) <= threshold) {
      return true;
    }
  }

  return false;
}

function createBuildPadsFromGrid(pathMap) {
  const routes = pathMap.getAllRoutePoints();
  const pads = [];
  let index = 1;

  for (let y = GRID_SIZE / 2; y < HEIGHT; y += GRID_SIZE) {
    const row = Math.floor((y - GRID_SIZE / 2) / GRID_SIZE);
    for (let x = GRID_SIZE / 2; x < WIDTH; x += GRID_SIZE) {
      const col = Math.floor((x - GRID_SIZE / 2) / GRID_SIZE);
      const center = { x, y };
      const blocked = routes.some((routePoints) => cellTouchesRoute(center, routePoints));
      if (blocked) {
        continue;
      }

      pads.push({
        id: `P${index++}`,
        x,
        y,
        col,
        row,
        towerId: null,
      });
    }
  }

  return pads;
}

function gridCellToPoint(col, row) {
  return {
    x: GRID_SIZE / 2 + col * GRID_SIZE,
    y: GRID_SIZE / 2 + row * GRID_SIZE,
  };
}

function sampleWithoutReplacement(values, count, rng) {
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.range(0, i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function chooseMidRows(startRow, endRow, availableRows, rng, minimumCells = 10) {
  const candidates = [];
  for (const firstRow of availableRows) {
    for (const secondRow of availableRows) {
      if (firstRow === secondRow) {
        continue;
      }
      const verticalCells = Math.abs(firstRow - startRow) + Math.abs(secondRow - firstRow) + Math.abs(endRow - secondRow);
      if (verticalCells >= minimumCells) {
        candidates.push([firstRow, secondRow]);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(rng.range(0, candidates.length))] ?? null;
}

function getRouteLengthBounds(difficulty) {
  const normalized = String(difficulty ?? "medium").toLowerCase();
  if (normalized === "easy") {
    return { min: 41, max: 70 };
  }
  if (normalized === "hard" || normalized === "extreme") {
    return { min: 41, max: 50 };
  }
  return { min: 41, max: 60 };
}

function getMapLockCost(difficulty) {
  const normalized = String(difficulty ?? "medium").toLowerCase();
  if (normalized === "easy") {
    return 1;
  }
  if (normalized === "hard") {
    return 5;
  }
  if (normalized === "extreme") {
    return 10;
  }
  return 3;
}

function getMapLockTooltip(difficulty) {
  const cost = getMapLockCost(difficulty);
  return {
    title: "Verrouiller map",
    lines: [`Le verrouillage de cette map coûtera automatiquement ${cost} points de sagesse lors de chaque nouveau run.`],
    accent: "#f4d35e",
  };
}

  function getAirPathPoints(pathMapRef, routeId, difficulty) {
    const normalized = String(difficulty ?? "medium").toLowerCase();
    if (normalized === "easy") {
      return null;
    }

    const ratios = normalized === "extreme" ? [0, 0.5, 1] : [0, 1 / 3, 2 / 3, 1];
    const points = ratios
      .map((ratio) => pathMapRef.getPointAtRatio(routeId, ratio))
      .filter(Boolean);

    return points.length >= 2 ? points : null;
  }

const AURA_EFFECT_SEQUENCE = ["power", "speed", "range", "slow", "reveal", "web", "chaos", "noarmor", "boost", "reduce", "cresus"];
const AURA_RANGE_SCALED_EFFECTS = new Set(["reveal", "web", "chaos", "boost"]);
const AURA_HIGHLIGHT_COLOR = "#fef08a";

function highlightAuraText(text) {
  return `<span style="color:${AURA_HIGHLIGHT_COLOR};">${text}</span>`;
}

function getAuraDisplayEffectName(effect) {
  const normalized = String(effect ?? "power").toLowerCase();
  if (normalized === "noarmor") {
    return "noArmor";
  }
  if (normalized === "cresus") {
    return "Cresus";
  }
  return normalized;
}

function getAuraEffectData(effect, level, range) {
  const normalized = String(effect ?? "power").toLowerCase();
  const activeLevel = Math.max(0, Math.floor(level));
  if (activeLevel <= 0) {
    return {
      summary: `effet(${getAuraDisplayEffectName(normalized)}), inactif`,
      lines: ["La tour Aura ne produit aucun effet au niveau 0.", "A partir du niveau 1, l'effet choisi est verrouille et commence a agir."],
    };
  }

  if (normalized === "power") {
    const value = Math.round(activeLevel * 3);
    return { summary: `power(+${value}% dmg tours)`, lines: [`Augmente les degats des tours a portee de ${value}%.`, `Portee actuelle: ${range}.`] };
  }
  if (normalized === "speed") {
    const value = Math.round(activeLevel * 3);
    return { summary: `speed(+${value}% cadence)`, lines: [`Augmente la vitesse d'attaque des tours a portee de ${value}%.`, `Portee actuelle: ${range}.`] };
  }
  if (normalized === "range") {
    const value = Math.round(activeLevel * 3);
    return { summary: `range(+${value}% portee)`, lines: [`Augmente la portee des tours a portee de ${value}%.`, `Portee actuelle: ${range}.`] };
  }
  if (normalized === "slow") {
    const moveMul = Math.max(0.1, 0.92 - activeLevel * 0.04);
    return { summary: `slow(x${moveMul.toFixed(2)})`, lines: [`Reduit la vitesse des creeps a portee a x${moveMul.toFixed(2)}.`, `Portee actuelle: ${range}.`] };
  }
  if (normalized === "reveal") {
    return { summary: `reveal(r=${range})`, lines: [`Revele les creeps invisibles dans un rayon de ${range}.`, "Les autres tours peuvent ensuite les cibler normalement."] };
  }
  if (normalized === "web") {
    return { summary: `web(r=${range})`, lines: [`Les creeps AIR dans un rayon de ${range} ne sont plus consideres volants.`, "Les tours ground peuvent alors les cibler."] };
  }
  if (normalized === "chaos") {
    return { summary: `chaos(r=${range})`, lines: [`Les tours dans un rayon de ${range} passent en type chaos.`, "Le changement apparait dans leurs infos de tour."] };
  }
  if (normalized === "noarmor") {
    const value = activeLevel * 3;
    return { summary: `noArmor(-${value})`, lines: [`Reduit l'armure effective des creeps a portee de ${value}.`, `Portee actuelle: ${range}.`] };
  }
  if (normalized === "boost") {
    return { summary: `boost(r=${range})`, lines: ["Amplifie fortement burn, poison, slow, freeze et stun sur les creeps a portee.", `Portee actuelle: ${range}.`] };
  }
  if (normalized === "reduce") {
    const value = Math.round((1 - Math.max(0.4, 1 - activeLevel * 0.02)) * 100);
    return { summary: `reduce(-${value}% couts)`, lines: [`Reduit les couts de construction et d'amelioration des tours a portee de ${value}%.`, `Portee actuelle: ${range}.`] };
  }
  const goldValue = Math.round(activeLevel * 12);
  const rarityChance = Math.round(Math.min(0.25, activeLevel * 0.02) * 100);
  return {
    summary: `Cresus(+${goldValue}% or, ${rarityChance}% rarete)`,
    lines: [`Augmente l'or des kills a portee de ${goldValue}%.`, `Chance de +1 rarete sur les drops: ${rarityChance}%.`, `Portee actuelle: ${range}.`],
  };
}

function getAuraEffectValues(effect, level) {
  const activeLevel = Math.max(0, Math.floor(level));
  const normalized = String(effect ?? "power").toLowerCase();
  return {
    damageMul: normalized === "power" ? 1 + activeLevel * 0.03 : 1,
    attackSpeedMul: normalized === "speed" ? 1 + activeLevel * 0.03 : 1,
    rangeMul: normalized === "range" ? 1 + activeLevel * 0.03 : 1,
    moveMul: normalized === "slow" ? Math.max(0.1, 0.92 - activeLevel * 0.04) : 1,
    armorReduction: normalized === "noarmor" ? activeLevel * 3 : 0,
    costMul: normalized === "reduce" ? Math.max(0.4, 1 - activeLevel * 0.02) : 1,
    goldMul: normalized === "cresus" ? 1 + activeLevel * 0.12 : 1,
    rarityChance: normalized === "cresus" ? Math.min(0.25, activeLevel * 0.02) : 0,
    reveal: normalized === "reveal",
    web: normalized === "web",
    chaos: normalized === "chaos",
    boost: normalized === "boost",
  };
}

function getAuraAttackDisplay(tower, level = tower?.level ?? 0) {
  if (!tower?.isAuraTower) {
    return `${tower?.damage ?? 0}`;
  }

  const effect = String(tower.selectedAuraEffect ?? "power").toLowerCase();
  const label = getAuraDisplayEffectName(effect);
  if (level <= 0) {
    return `${label} (inactif)`;
  }

  const values = getAuraEffectValues(effect, level);
  if (effect === "power") {
    return `${label} (+${Math.round((values.damageMul - 1) * 100)}%)`;
  }
  if (effect === "speed") {
    return `${label} (+${Math.round((values.attackSpeedMul - 1) * 100)}%)`;
  }
  if (effect === "range") {
    return `${label} (+${Math.round((values.rangeMul - 1) * 100)}%)`;
  }
  if (effect === "slow") {
    return `${label} (x${values.moveMul.toFixed(2)})`;
  }
  if (effect === "noarmor") {
    return `${label} (-${values.armorReduction})`;
  }
  if (effect === "reduce") {
    return `${label} (-${Math.round((1 - values.costMul) * 100)}%)`;
  }
  if (effect === "cresus") {
    return `${label} (+${Math.round((values.goldMul - 1) * 100)}% or)`;
  }
  return `${label} (r=${tower.getAuraRangeAtLevel?.(level, effect) ?? tower.range})`;
}

function getTowerAttackTooltip(tower) {
  if (!tower?.isAuraTower) {
    return {
      title: "Attaque",
      lines: [`Dégâts actuels: ${tower?.damage ?? 0}`, `Type: ${tower?.getCurrentDamageType?.() ?? tower?.damageType ?? "physical"}`],
      accent: tower?.color ?? "#93c5fd",
    };
  }

  const effect = String(tower.selectedAuraEffect ?? "power").toLowerCase();
  const previewLevel = tower.level <= 0 ? 1 : tower.level;
  const info = getAuraEffectData(effect, previewLevel, tower.getAuraRangeAtLevel?.(previewLevel, effect) ?? tower.range);
  return {
    title: `Effet Aura: ${getAuraDisplayEffectName(effect)}`,
    lines: tower.level <= 0
      ? [`Au niveau 1: ${info.summary}`, ...info.lines]
      : info.lines,
    accent: tower?.color ?? "#fef08a",
  };
}

function formatAuraTowerStatValue(currentValue, auraNote = "") {
  if (!auraNote) {
    return String(currentValue);
  }
  return `${highlightAuraText(String(currentValue))} ${highlightAuraText(`(${auraNote})`)}`;
}

function chooseMidRowsInRange(startRow, endRow, availableRows, rng, minVerticalCells, maxVerticalCells) {
  const candidates = [];
  for (const firstRow of availableRows) {
    for (const secondRow of availableRows) {
      if (firstRow === secondRow) {
        continue;
      }
      const verticalCells = Math.abs(firstRow - startRow) + Math.abs(secondRow - firstRow) + Math.abs(endRow - secondRow);
      if (verticalCells >= minVerticalCells && verticalCells <= maxVerticalCells) {
        candidates.push([firstRow, secondRow]);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(rng.range(0, candidates.length))] ?? null;
}

function pickEndpointSidePairs(rng) {
  const balancedLayouts = [
    [["left", "right"], ["left", "right"]],
    [["left", "right"], ["right", "left"]],
    [["right", "left"], ["left", "right"]],
    [["right", "left"], ["right", "left"]],
    [["left", "left"], ["right", "right"]],
    [["right", "right"], ["left", "left"]],
  ];
  const leftHeavyLayouts = [
    [["left", "left"], ["left", "right"]],
    [["left", "left"], ["right", "left"]],
    [["left", "right"], ["left", "left"]],
    [["right", "left"], ["left", "left"]],
  ];
  const rightHeavyLayouts = [
    [["right", "right"], ["right", "left"]],
    [["right", "right"], ["left", "right"]],
    [["right", "left"], ["right", "right"]],
    [["left", "right"], ["right", "right"]],
  ];

  const pool = rng.next() < 0.75
    ? balancedLayouts
    : (rng.next() < 0.5 ? leftHeavyLayouts : rightHeavyLayouts);
  return pool[Math.floor(rng.range(0, pool.length))] ?? balancedLayouts[0];
}

function getRouteColumnsForSides(routeId, startSide, endSide) {
  const oppositeColumns = {
    upper: {
      left_right: [7, 15, 23],
      right_left: [24, 16, 8],
    },
    lower: {
      left_right: [10, 18, 26],
      right_left: [21, 13, 5],
    },
  };
  const sameSideColumns = {
    upper: {
      left_left: [8, 20, 8],
      right_right: [23, 11, 23],
    },
    lower: {
      left_left: [11, 21, 11],
      right_right: [20, 10, 20],
    },
  };
  const key = `${startSide}_${endSide}`;
  return sameSideColumns[routeId]?.[key] ?? oppositeColumns[routeId]?.[key] ?? [7, 15, 23];
}

function buildRouteCells({ startSide, endSide, startRow, endRow, midColumns, midRows }) {
  const startCol = startSide === "right" ? Math.floor(WIDTH / GRID_SIZE) - 1 : 0;
  const endCol = endSide === "right" ? Math.floor(WIDTH / GRID_SIZE) - 1 : 0;
  const [col1, col2, col3] = midColumns;
  const [midRow1, midRow2] = midRows;
  return [
    [startCol, startRow],
    [col1, startRow],
    [col1, midRow1],
    [col2, midRow1],
    [col2, midRow2],
    [col3, midRow2],
    [col3, endRow],
    [endCol, endRow],
  ];
}

function getRouteLengthInCells(routeCells) {
  let total = 0;
  for (let i = 1; i < routeCells.length; i += 1) {
    total += Math.abs(routeCells[i][0] - routeCells[i - 1][0]) + Math.abs(routeCells[i][1] - routeCells[i - 1][1]);
  }
  return total;
}

function enumerateRouteCells(routeCells) {
  const visited = [];
  for (let i = 1; i < routeCells.length; i += 1) {
    const [fromCol, fromRow] = routeCells[i - 1];
    const [toCol, toRow] = routeCells[i];
    const stepCol = Math.sign(toCol - fromCol);
    const stepRow = Math.sign(toRow - fromRow);
    let col = fromCol;
    let row = fromRow;
    if (i === 1) {
      visited.push(`${col},${row}`);
    }
    while (col !== toCol || row !== toRow) {
      col += stepCol;
      row += stepRow;
      visited.push(`${col},${row}`);
    }
  }
  return visited;
}

function hasInvalidRouteOverlap(routeCellsList) {
  const occupancy = new Map();
  routeCellsList.forEach((routeCells, routeIndex) => {
    const uniqueCells = new Set(enumerateRouteCells(routeCells));
    for (const cellKey of uniqueCells) {
      const routes = occupancy.get(cellKey) ?? new Set();
      routes.add(routeIndex);
      occupancy.set(cellKey, routes);
    }
  });

  const sharedCells = Array.from(occupancy.entries())
    .filter(([, routes]) => routes.size > 1)
    .map(([cellKey]) => cellKey);
  const sharedSet = new Set(sharedCells);

  for (const cellKey of sharedCells) {
    const [col, row] = cellKey.split(",").map(Number);
    if (
      sharedSet.has(`${col + 1},${row}`)
      || sharedSet.has(`${col - 1},${row}`)
      || sharedSet.has(`${col},${row + 1}`)
      || sharedSet.has(`${col},${row - 1}`)
    ) {
      return true;
    }
  }

  return false;
}

function createFallbackPathConfig() {
  const upperRouteCells = [
    [0, 2],
    [7, 2],
    [7, 7],
    [15, 7],
    [15, 10],
    [23, 10],
    [23, 14],
    [31, 14],
  ];
  const lowerRouteCells = [
    [0, 15],
    [10, 15],
    [10, 11],
    [18, 11],
    [18, 7],
    [26, 7],
    [26, 3],
    [31, 3],
  ];
  return {
    routes: [
      {
        id: "upper",
        points: upperRouteCells.map(([col, row]) => gridCellToPoint(col, row)),
      },
      {
        id: "lower",
        points: lowerRouteCells.map(([col, row]) => gridCellToPoint(col, row)),
      },
    ],
    spawnPoints: [
      { id: "spawn-upper", routeId: "upper" },
      { id: "spawn-lower", routeId: "lower" },
    ],
  };
}

function generatePathConfig(rng, difficulty = "medium") {
  const candidateRows = Array.from({ length: Math.floor(HEIGHT / GRID_SIZE) - 2 }, (_, index) => index + 1);
  const lengthBounds = getRouteLengthBounds(difficulty);

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const [[upperStartSide, upperEndSide], [lowerStartSide, lowerEndSide]] = pickEndpointSidePairs(rng);
    const [startUpper, endUpper, startLower, endLower] = sampleWithoutReplacement(candidateRows, 4, rng);
    const remainingRowsForUpper = candidateRows.filter((row) => ![startUpper, endUpper, startLower, endLower].includes(row));
    const upperColumns = getRouteColumnsForSides("upper", upperStartSide, upperEndSide);
    const lowerColumns = getRouteColumnsForSides("lower", lowerStartSide, lowerEndSide);
    const upperHorizontal = getRouteLengthInCells(buildRouteCells({
      startSide: upperStartSide,
      endSide: upperEndSide,
      startRow: startUpper,
      endRow: endUpper,
      midColumns: upperColumns,
      midRows: [startUpper, endUpper],
    }).map(([col, row], index, points) => {
      if (index % 2 === 1) {
        return [col, points[index - 1][1]];
      }
      return [col, row];
    }));
    const lowerHorizontal = getRouteLengthInCells(buildRouteCells({
      startSide: lowerStartSide,
      endSide: lowerEndSide,
      startRow: startLower,
      endRow: endLower,
      midColumns: lowerColumns,
      midRows: [startLower, endLower],
    }).map(([col, row], index, points) => {
      if (index % 2 === 1) {
        return [col, points[index - 1][1]];
      }
      return [col, row];
    }));
    const upperVerticalMin = Math.max(0, lengthBounds.min - upperHorizontal);
    const upperVerticalMax = Math.max(upperVerticalMin, lengthBounds.max - upperHorizontal);
    const upperMids = chooseMidRowsInRange(startUpper, endUpper, remainingRowsForUpper, rng, upperVerticalMin, upperVerticalMax);
    if (!upperMids) {
      continue;
    }

    const remainingRowsForLower = remainingRowsForUpper.filter((row) => !upperMids.includes(row));
    const lowerVerticalMin = Math.max(0, lengthBounds.min - lowerHorizontal);
    const lowerVerticalMax = Math.max(lowerVerticalMin, lengthBounds.max - lowerHorizontal);
    const lowerMids = chooseMidRowsInRange(startLower, endLower, remainingRowsForLower, rng, lowerVerticalMin, lowerVerticalMax);
    if (!lowerMids) {
      continue;
    }

    const upperRouteCells = buildRouteCells({
      startSide: upperStartSide,
      endSide: upperEndSide,
      startRow: startUpper,
      endRow: endUpper,
      midColumns: upperColumns,
      midRows: upperMids,
    });
    const lowerRouteCells = buildRouteCells({
      startSide: lowerStartSide,
      endSide: lowerEndSide,
      startRow: startLower,
      endRow: endLower,
      midColumns: lowerColumns,
      midRows: lowerMids,
    });

    const upperLength = getRouteLengthInCells(upperRouteCells);
    const lowerLength = getRouteLengthInCells(lowerRouteCells);
    if (upperLength < lengthBounds.min || upperLength > lengthBounds.max || lowerLength < lengthBounds.min || lowerLength > lengthBounds.max) {
      continue;
    }
    if (Math.abs(upperLength - lowerLength) > 6) {
      continue;
    }
    if (hasInvalidRouteOverlap([upperRouteCells, lowerRouteCells])) {
      continue;
    }

    return {
      routes: [
        {
          id: "upper",
          points: upperRouteCells.map(([col, row]) => gridCellToPoint(col, row)),
        },
        {
          id: "lower",
          points: lowerRouteCells.map(([col, row]) => gridCellToPoint(col, row)),
        },
      ],
      spawnPoints: [
        { id: "spawn-upper", routeId: "upper" },
        { id: "spawn-lower", routeId: "lower" },
      ],
    };
  }

  return createFallbackPathConfig();
}

function createRouteFromRows({ routeId, startRow, endRow, midRows }) {
  const startSide = Math.random() < 0.5 ? "left" : "right";
  const endSide = startSide === "left" ? "right" : "left";
  const columns = getRouteColumnsForSides(routeId, startSide, endSide);
  const routeCells = buildRouteCells({
    startSide,
    endSide,
    startRow,
    endRow,
    midColumns: columns,
    midRows,
  });
  return {
    id: routeId,
    points: routeCells.map(([col, row]) => gridCellToPoint(col, row)),
  };
}

function buildFallbackMultiRouteConfig(routeCount) {
  const rows = [2, 7, 11, 15];
  const routes = [];
  const spawnPoints = [];
  for (let i = 0; i < routeCount; i += 1) {
    const routeId = i === 0 ? "upper" : i === 1 ? "lower" : `route-${i + 1}`;
    const startRow = rows[(i * 2) % rows.length];
    const endRow = rows[(i * 2 + 1) % rows.length];
    const midRows = [Math.max(1, Math.min(16, startRow + 3)), Math.max(1, Math.min(16, endRow - 2))];
    routes.push(createRouteFromRows({ routeId, startRow, endRow, midRows }));
    spawnPoints.push({ id: `spawn-${routeId}`, routeId });
  }
  return { routes, spawnPoints };
}

function generatePathConfigForMode(rng, difficulty = "medium", mode = "standard") {
  const normalized = String(mode ?? "standard").toLowerCase();
  if (normalized === "standard") {
    return generatePathConfig(rng, difficulty);
  }

  const routeCount = normalized === "triple" ? 3 : 1;
  const candidateRows = Array.from({ length: Math.floor(HEIGHT / GRID_SIZE) - 2 }, (_, index) => index + 1);
  const lengthBounds = getRouteLengthBounds(difficulty);

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const pickedRows = sampleWithoutReplacement(candidateRows, Math.max(routeCount * 4, 4), rng);
    const routeCellsList = [];
    const routes = [];
    const spawnPoints = [];

    for (let i = 0; i < routeCount; i += 1) {
      const routeId = i === 0 ? "upper" : i === 1 ? "lower" : `route-${i + 1}`;
      const startRow = pickedRows[i * 2] ?? rng.int(1, 16);
      const endRow = pickedRows[i * 2 + 1] ?? rng.int(1, 16);
      const freeRows = candidateRows.filter((row) => row !== startRow && row !== endRow);
      const mids = chooseMidRowsInRange(startRow, endRow, freeRows, rng, 4, 26) ?? [startRow, endRow];
      const [startSide, endSide] = i % 2 === 0 ? ["left", "right"] : ["right", "left"];
      const columns = getRouteColumnsForSides(routeId, startSide, endSide);
      const routeCells = buildRouteCells({
        startSide,
        endSide,
        startRow,
        endRow,
        midColumns: columns,
        midRows: mids,
      });

      const routeLength = getRouteLengthInCells(routeCells);
      if (routeLength < lengthBounds.min || routeLength > lengthBounds.max) {
        routes.length = 0;
        break;
      }

      routeCellsList.push(routeCells);
      routes.push({ id: routeId, points: routeCells.map(([col, row]) => gridCellToPoint(col, row)) });
      spawnPoints.push({ id: `spawn-${routeId}`, routeId });
    }

    if (routes.length !== routeCount) {
      continue;
    }
    if (hasInvalidRouteOverlap(routeCellsList)) {
      continue;
    }

    if (normalized === "triple") {
      const endpointCounts = { left: 0, right: 0 };
      for (const route of routeCellsList) {
        const first = route[0][0] === 0 ? "left" : "right";
        const last = route[route.length - 1][0] === 0 ? "left" : "right";
        endpointCounts[first] += 1;
        endpointCounts[last] += 1;
      }
      if (endpointCounts.left < 2 || endpointCounts.right < 2 || endpointCounts.left > 4 || endpointCounts.right > 4) {
        continue;
      }
    }

    return { routes, spawnPoints };
  }

  return buildFallbackMultiRouteConfig(routeCount);
}

function mountLayout() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <section id="menuScreen" class="menu-screen">
      <div class="menu-screen__backdrop"></div>
      <div class="menu-screen__card">
        <img class="menu-screen__logo" src="./WiziTD.png" alt="WiziTD" />
        <div class="menu-screen__actions">
          <button id="menuStartBtn" type="button">Commencer</button>
          <button id="menuContinueBtn" type="button">Continuer</button>
          <button id="menuExportBtn" type="button">Exporter</button>
        </div>
      </div>
    </section>

    <section id="modalLayer" class="menu-modal-layer hidden" aria-live="polite"></section>
    <input id="importSaveInput" type="file" accept=".wizisav" class="hidden" />

    <section id="gameRoot" class="hidden">
    <section class="top-wrap">
      <section class="top-main" id="topMain"></section>
      <section class="top-sub">
        <div id="playerProgressBadge" class="player-progress-badge" role="status" aria-live="polite" tabindex="0">
          <span id="playerProgressLabel">Niv 1</span>
          <span class="player-progress-badge__bar"><span id="playerProgressFill" class="player-progress-badge__fill"></span></span>
        </div>
        <button id="resetBtn" type="button">Reset run (R)</button>
        <button id="lockMapBtn" type="button">Verrouiller map</button>
        <span id="preWaveCountdown" class="pre-wave-countdown" aria-live="polite">Preparation: 00:30</span>
      </section>
    </section>

    <section class="content-wrap">
      <section class="game-wrap">
        <canvas id="gameCanvas" width="${WIDTH}" height="${HEIGHT}"></canvas>
        <section id="runOverlay" class="run-overlay hidden" aria-live="polite"></section>
        <section id="waveInfoPanel" class="wave-info-panel hidden" aria-live="polite"></section>
          <section id="inventoryPanel" class="inventory-panel hidden" aria-live="polite"></section>
      </section>

      <aside class="side-panel">
        <section class="side-block">
          <h3>Tours</h3>
          <div id="towerBuildGroup" class="btn-group">
            <button id="towerSentinelBtn" type="button">Sentinel</button>
            <button id="towerPyroBtn" type="button">Pyro</button>
            <button id="towerArcBtn" type="button">Elfe</button>
            <button id="towerFrozenBtn" type="button">Frozen</button>
            <button id="towerRonceBtn" type="button">Ronce</button>
            <button id="towerCanonBtn" type="button">Canon</button>
            <button id="towerRicochetBtn" type="button">Ricochet</button>
            <button id="towerMachinegunBtn" type="button">Machinegun</button>
            <button id="towerScorpioBtn" type="button">Scorpio</button>
            <button id="towerAuraBtn" type="button">Aura</button>
          </div>
          <div id="towerStats" class="tower-stats">Tour: aucune selection</div>
          <div id="towerManageGroup" class="btn-group hidden">
            <button id="upgradeBtn" type="button">Ameliorer tour (U)</button>
            <button id="towerAddItemBtn" type="button">Ajouter objet</button>
            <button id="sellBtn" type="button">Vendre tour</button>
            <button id="orderBtn" type="button">Ordre: proche</button>
          </div>
        </section>

        <section class="side-block">
          <h3>Objets / Compétences</h3>
          <div class="btn-group">
            <button id="wisdomBtn" type="button">Sagesse</button>
            <button id="inventoryBtn" type="button">Inventaire</button>
            <button id="craftBtn" type="button">Boutique</button>
          </div>
        </section>

        <p id="sideHint" class="hint"></p>
        <p id="padInfo"></p>
      </aside>

      <div id="towerHoverCard" class="tower-hover-card hidden" aria-hidden="true"></div>
      <div id="infoHoverCard" class="info-hover-card hidden" aria-hidden="true"></div>
      <section id="knowledgePanel" class="knowledge-panel hidden" aria-live="polite"></section>
    </section>

    <section class="bottom-bar">
      <button id="pauseBtn" type="button">Pause</button>
      <button id="speedBtn" type="button">Vitesse x1</button>
      <button id="waveBtn" type="button">Lancer vague</button>
      <button id="autoBtn" type="button">Auto ON</button>
      <span id="controlInfo"></span>
      <button id="waveInfoBtn" type="button">Info vague</button>
    </section>
    </section>
  `;

  return {
    menuScreen: document.querySelector("#menuScreen"),
    gameRoot: document.querySelector("#gameRoot"),
    modalLayer: document.querySelector("#modalLayer"),
    menuStartBtn: document.querySelector("#menuStartBtn"),
    menuContinueBtn: document.querySelector("#menuContinueBtn"),
    menuExportBtn: document.querySelector("#menuExportBtn"),
    importSaveInput: document.querySelector("#importSaveInput"),
    canvas: document.querySelector("#gameCanvas"),
    topMain: document.querySelector("#topMain"),
    controlInfo: document.querySelector("#controlInfo"),
    waveInfoPanel: document.querySelector("#waveInfoPanel"),
    playerProgressBadge: document.querySelector("#playerProgressBadge"),
    playerProgressLabel: document.querySelector("#playerProgressLabel"),
    playerProgressFill: document.querySelector("#playerProgressFill"),
    padInfo: document.querySelector("#padInfo"),
    towerStats: document.querySelector("#towerStats"),
    towerHoverCard: document.querySelector("#towerHoverCard"),
    infoHoverCard: document.querySelector("#infoHoverCard"),
    knowledgePanel: document.querySelector("#knowledgePanel"),
    inventoryPanel: document.querySelector("#inventoryPanel"),
    sideHint: document.querySelector("#sideHint"),
    pauseBtn: document.querySelector("#pauseBtn"),
    speedBtn: document.querySelector("#speedBtn"),
    waveBtn: document.querySelector("#waveBtn"),
    autoBtn: document.querySelector("#autoBtn"),
    waveInfoBtn: document.querySelector("#waveInfoBtn"),
    towerBuildGroup: document.querySelector("#towerBuildGroup"),
    towerManageGroup: document.querySelector("#towerManageGroup"),
    towerSentinelBtn: document.querySelector("#towerSentinelBtn"),
    towerPyroBtn: document.querySelector("#towerPyroBtn"),
    towerArcBtn: document.querySelector("#towerArcBtn"),
    towerFrozenBtn: document.querySelector("#towerFrozenBtn"),
    towerRonceBtn: document.querySelector("#towerRonceBtn"),
    towerCanonBtn: document.querySelector("#towerCanonBtn"),
    towerRicochetBtn: document.querySelector("#towerRicochetBtn"),
    towerMachinegunBtn: document.querySelector("#towerMachinegunBtn"),
    towerScorpioBtn: document.querySelector("#towerScorpioBtn"),
    towerAuraBtn: document.querySelector("#towerAuraBtn"),
    inventoryBtn: document.querySelector("#inventoryBtn"),
    preWaveCountdown: document.querySelector("#preWaveCountdown"),
    wisdomBtn: document.querySelector("#wisdomBtn"),
    craftBtn: document.querySelector("#craftBtn"),
    towerAddItemBtn: document.querySelector("#towerAddItemBtn"),
    upgradeBtn: document.querySelector("#upgradeBtn"),
    sellBtn: document.querySelector("#sellBtn"),
    orderBtn: document.querySelector("#orderBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    lockMapBtn: document.querySelector("#lockMapBtn"),
    runOverlay: document.querySelector("#runOverlay"),
  };
}

async function boot() {
  const ui = mountLayout();
  const ctx = ui.canvas.getContext("2d");

  const seed = 20260803;
  const rng = new SeededRandom(seed);
  const waveRng = new SeededRandom(seed ^ 0x9e3779b9);
  const bus = new EventBus();
  const csvLoader = new CsvLoader();
  const docLoader = new DocumentationLoader();
  const docParser = new DocumentationParser();
  const docIngestion = new DocumentationIngestion();

  const parsedTowers = csvLoader.parseTowers(sampleTowerCsv);
  const registry = new DataRegistry();
  registry.registerMany("towers", parsedTowers, "id");

  let documentationSummary = "Doc runtime: indisponible";
  let documentationIssues = "";
  let specialPool = [];
  let blueprintSource = "fallback";
  let missionSource = "fallback";
  try {
    const markdown = await docLoader.loadFromPublicPath("./DOCUMENTATION_JEU_FR.md");
    const parsedDoc = docParser.parse(markdown);

    const ingestionResult = docIngestion.ingest(parsedDoc, registry);
    const c = ingestionResult.counts;
    documentationSummary = `Doc strict - tours:${c.towers} objets:${c.items} capa:${c.abilities} auras:${c.auras} autocasts:${c.autocasts} missions:${c.missions} specials:${c.waveSpecials} recettes:${c.recipes}`;
    specialPool = ingestionResult.specialPool;
    documentationIssues =
      ingestionResult.issues.length > 0
        ? `Refs manquantes: ${ingestionResult.issues.length}`
        : "Refs manquantes: 0";
  } catch (error) {
    documentationSummary = `Doc runtime: erreur (${error.message})`;
    documentationIssues = "Refs manquantes: n/a";
  }

  const blueprintSetup = createTowerBlueprints(registry);
  const TOWER_BLUEPRINTS = blueprintSetup.blueprints;
  const towerTypeOrder = blueprintSetup.order;
  blueprintSource = blueprintSetup.source;

  const missionSetup = createMissionPresets(registry);
  const missions = missionSetup.presets;
  const missionOrder = missionSetup.order;
  let selectedMissionId = missionOrder[0];
  missionSource = missionSetup.source;
  const saveProfileSystem = new SaveProfileSystem();
  saveProfileSystem.load();
  let activeProfileId = null;
  let activeProfileName = "";
  let selectedGameMode = "standard";
  let runInitialized = false;
  let sessionElapsedSeconds = 0;
  let sessionLastTimestamp = performance.now();
  const metaSystem = new MetaProgressionSystem({ registry });
  const meta = metaSystem.load();
  const getModeUnlocks = () => saveProfileSystem.getUnlocks();
  const isModeUnlocked = (mode) => {
    const unlocks = getModeUnlocks();
    const normalized = String(mode ?? "standard").toLowerCase();
    if (normalized === "triple") {
      return unlocks.tripleUnlocked;
    }
    if (normalized === "solo") {
      return unlocks.soloUnlocked;
    }
    return true;
  };
  const isExtremeUnlocked = () => getModeUnlocks().extremeUnlocked;
  const getAvailableDifficulties = () => (isExtremeUnlocked() ? ["easy", "medium", "hard", "extreme"] : ["easy", "medium", "hard"]);
  let selectedDifficulty = String(missions[selectedMissionId]?.difficulty ?? "medium").toLowerCase();
  if (!getAvailableDifficulties().includes(selectedDifficulty)) {
    selectedDifficulty = "medium";
  }
  let activeDifficulty = selectedDifficulty;

  const itemSystem = new ItemSystem({ registry, rng });
  const auraSystem = new AuraSystem({ registry });
  const autocastSystem = new AutocastSystem({ registry, bus, rng });
  const waveModifierSystem = new WaveModifierSystem({ rng });
  const eliteAffixSystem = new EliteAffixSystem({ rng, bus });
  const bossAbilitySystem = new BossAbilitySystem({ rng, bus });

  let pathMap = new PathMap(generatePathConfigForMode(rng, selectedDifficulty, selectedGameMode));
  let spawnPoints = pathMap.getSpawnPoints();
  let buildPads = createBuildPadsFromGrid(pathMap);
  const towers = [];
  let nextTowerNum = 1;
  let mapLocked = false;

  const waveGenerator = new WaveGenerator({ rng: waveRng, difficulty: activeDifficulty, specialPool });
  const waveSpawner = new WaveSpawner({ rng, bus });
  let currentWaveLevel = 1;
  let creepsKilledInWave = 0;
  let creepsLeakedInWave = 0;
  let totalKills = 0;
  let score = 0;
  let gold = activeDifficulty === "easy" ? 300 : activeDifficulty === "hard" ? 145 : 198;
  let portalLives = activeDifficulty === "easy" ? 50 : activeDifficulty === "hard" ? 10 : 23;
  let stash = [];
  let waveSpawnFinished = false;
  let combatLastHit = "";
  let gamePaused = false;
  let speedLevel = 1;
  let autoWave = true;
  const waveProgress = new Map();
  let buildMessage = "Build: clic gauche sur pad vide | Sell: clic droit sur pad occupe";
  let selectedPadId = null;
  let hoveredPadId = null;
  let hoveredWorldPos = null;
  let selectedTowerType = null;
  let showUpgradePreview = false;
  let gameEnded = false;
  let victory = false;
  let preWaveRemainingMs = PRE_WAVE_DURATION_MS;
  let preWaveActive = true;
  let targetWave = TARGET_WAVE_VICTORY;
  let activeWaveModifiers = null;
  let currentBossPhase = 1;
  let runResolved = false;
  let runBonuses = metaSystem.getRunBonuses(activeDifficulty);
  let waveInfoOpen = false;
  let inventoryPanelOpen = false;
  let inventoryPanelMode = "inventory";
  let pendingTowerItemTargetId = null;
  let pendingTowerSelectionItemId = null;
  let stashSortMode = "rarity";
  const generatedWaves = new Map();
  const completedWaveLevels = new Set();
  let awaitingVictoryChoice = false;
  let endlessMode = false;
  let knowledgePanelStateKey = "";

  const syncMetaSnapshot = () => {
    Object.assign(meta, JSON.parse(JSON.stringify(metaSystem.state)));
  };

  const applyMetaState = (metaState) => {
    if (!metaState || typeof metaState !== "object") {
      return;
    }
    Object.assign(metaSystem.state, {
      ...metaSystem.state,
      ...metaState,
      knowledgeLevels: {
        ...metaSystem.state.knowledgeLevels,
        ...(metaState.knowledgeLevels ?? {}),
      },
      knowledgeUnlocked: {
        ...metaSystem.state.knowledgeUnlocked,
        ...(metaState.knowledgeUnlocked ?? {}),
      },
    });
    metaSystem.save();
    syncMetaSnapshot();
  };

  const formatDuration = (seconds) => {
    const value = Math.max(0, Math.floor(seconds));
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const serializeCurrentRunState = () => ({
    selectedDifficulty,
    activeDifficulty,
    selectedGameMode,
    selectedMissionId: "balanced",
    mapLocked,
    pathConfig: {
      routes: Array.from(pathMap.routes.entries()).map(([id, points]) => ({
        id,
        points: points.map((p) => ({ x: p.x, y: p.y })),
      })),
      spawnPoints: pathMap.getSpawnPoints(),
    },
    currentWaveLevel,
    totalKills,
    score,
    gold,
    portalLives,
    stash,
    towers: towers.map((tower) => ({
      id: tower.id,
      blueprintId: tower.blueprintId,
      position: { ...tower.position },
      level: tower.level,
      xp: tower.xp,
      baseRange: tower.baseRange,
      baseDamage: tower.baseDamage,
      baseAttackCd: tower.baseAttackCd,
      investedGold: tower.investedGold,
      targetMode: tower.targetMode,
      selectedAuraEffect: tower.selectedAuraEffect,
      padIds: tower.padIds,
      items: tower.items,
      hasEyes: tower.hasEyes,
      revealInvisible: tower.revealInvisible,
    })),
    nextTowerNum,
    creeps: creeps.map((creep) => creep.toSnapshot?.() ?? null).filter(Boolean),
    waveSpawnerState: waveSpawner.getSnapshot?.() ?? [],
    currentBossPhase,
    waveSpawnFinished,
    waveProgress: Array.from(waveProgress.entries()),
    generatedWaves: Array.from(generatedWaves.entries()),
    completedWaveLevels: Array.from(completedWaveLevels.values()),
    preWaveRemainingMs,
    preWaveActive,
    gameEnded,
    victory,
    endlessMode,
    awaitingVictoryChoice,
    targetWave,
    runResolved,
    sessionElapsedSeconds,
  });

  const saveActiveProfileSnapshot = () => {
    if (!activeProfileId) {
      return;
    }
    const existing = saveProfileSystem.getById(activeProfileId);
    if (!existing) {
      return;
    }

    const updatedProfile = {
      ...existing,
      name: activeProfileName,
      config: {
        ...existing.config,
        difficulty: selectedDifficulty,
        gameMode: selectedGameMode,
        missionId: "balanced",
        mapLocked,
      },
      stats: {
        ...existing.stats,
        totalKills: meta.totalKills,
        totalRuns: meta.runs,
        totalXp: meta.playerXp,
        playerLevel: meta.playerLevel,
        sagesseDisponible: meta.sagessePoints,
        sagesseDepensee: Math.max(0, (existing.stats?.sagesseTotaleGagnee ?? 0) - meta.sagessePoints),
        sagesseTotaleGagnee: Math.max(existing.stats?.sagesseTotaleGagnee ?? 0, meta.sagessePoints),
        bestWave: Math.max(existing.stats?.bestWave ?? 0, meta.bestWave ?? 0, currentWaveLevel),
        highestWaveEver: Math.max(existing.stats?.highestWaveEver ?? 0, meta.highestWaveEver ?? 0),
        totalPlayTimeSeconds: Math.max(0, Math.floor((existing.stats?.totalPlayTimeSeconds ?? 0) + sessionElapsedSeconds)),
        wins: meta.wins ?? 0,
      },
      knowledge: {
        levels: { ...(meta.knowledgeLevels ?? {}) },
        unlocked: { ...(meta.knowledgeUnlocked ?? {}) },
      },
      metaSnapshot: JSON.parse(JSON.stringify(metaSystem.state)),
      runState: serializeCurrentRunState(),
    };
    updatedProfile.stats.sagesseTotaleGagnee = updatedProfile.stats.sagesseDisponible + updatedProfile.stats.sagesseDepensee;
    saveProfileSystem.upsertProfile(updatedProfile);
  };

  const hideModal = () => {
    ui.modalLayer.classList.add("hidden");
    ui.modalLayer.innerHTML = "";
  };

  const showToast = (message, type = "info") => {
    const containerId = "menuToastContainer";
    let container = document.querySelector(`#${containerId}`);
    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "menu-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `menu-toast menu-toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("menu-toast--hide");
      window.setTimeout(() => {
        toast.remove();
      }, 260);
    }, 2200);
  };

  const showModal = (markup) => {
    ui.modalLayer.innerHTML = markup;
    ui.modalLayer.classList.remove("hidden");
  };

  const showGameShell = () => {
    ui.menuScreen.classList.add("hidden");
    ui.gameRoot.classList.remove("hidden");
    runInitialized = true;
    hideModal();
  };

  const showMenuShell = () => {
    runInitialized = false;
    ui.gameRoot.classList.add("hidden");
    ui.menuScreen.classList.remove("hidden");
    hideModal();
  };

  const buildProfileTooltip = (profile) => {
    const stats = profile.stats ?? {};
    const config = profile.config ?? {};
    return [
      `Pseudo: ${profile.name}`,
      `Mode: ${config.gameMode ?? "standard"}`,
      `Difficulté: ${config.difficulty ?? "medium"}`,
      `Vague max: ${stats.bestWave ?? 0}`,
      `Kills: ${stats.totalKills ?? 0}`,
      `Runs: ${stats.totalRuns ?? 0}`,
      `Niveau: ${stats.playerLevel ?? 1}`,
      `Sagesse: ${stats.sagesseDisponible ?? 0}/${stats.sagesseTotaleGagnee ?? 0}`,
      `Temps: ${formatDuration(stats.totalPlayTimeSeconds ?? 0)}`,
    ].join("\n");
  };

  const downloadExportPayload = (profileId) => {
    if (activeProfileId && profileId === activeProfileId) {
      saveActiveProfileSnapshot();
    }

    const profile = saveProfileSystem.getById(profileId);
    if (!profile) {
      return;
    }
    const payload = saveProfileSystem.buildExportPayload(profileId);
    if (!payload) {
      return;
    }
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = saveProfileSystem.buildExportFilename(profile);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(`Export réussi: ${anchor.download}`, "success");
  };

  const openExportModal = () => {
    const profiles = saveProfileSystem.list();
    const listMarkup = profiles.length === 0
      ? '<div class="menu-modal__empty">Aucune partie à exporter.</div>'
      : profiles
        .map((profile) => `
          <button type="button" class="menu-modal__list-item" data-export-id="${profile.id}" title="${escapeHtml(buildProfileTooltip(profile))}">
            <span>${escapeHtml(profile.name)}</span>
            <span>Vague max ${profile.stats?.bestWave ?? 0}</span>
          </button>
        `)
        .join("");

    showModal(`
      <div class="menu-modal__backdrop"></div>
      <div class="menu-modal__card">
        <h3>Exporter une partie</h3>
        <div class="menu-modal__list">${listMarkup}</div>
        <div class="menu-modal__actions">
          <button id="modalCloseBtn" type="button">Fermer</button>
        </div>
      </div>
    `);

    ui.modalLayer.querySelector("#modalCloseBtn")?.addEventListener("click", () => hideModal());
    ui.modalLayer.querySelectorAll("[data-export-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const profileId = button.dataset.exportId;
        downloadExportPayload(profileId);
        hideModal();
      });
    });
  };

  const loadProfileIntoRun = (profile) => {
    if (!profile) {
      return;
    }
    activeProfileId = profile.id;
    activeProfileName = profile.name;

    if (profile.metaSnapshot) {
      applyMetaState(profile.metaSnapshot);
    }
    if (profile.knowledge) {
      applyMetaState({
        knowledgeLevels: profile.knowledge.levels ?? {},
        knowledgeUnlocked: profile.knowledge.unlocked ?? {},
      });
    }

    selectedDifficulty = String(profile.config?.difficulty ?? "medium").toLowerCase();
    if (!getAvailableDifficulties().includes(selectedDifficulty)) {
      selectedDifficulty = "medium";
    }
    selectedGameMode = String(profile.config?.gameMode ?? "standard").toLowerCase();
    if (!GAME_MODES.includes(selectedGameMode) || !isModeUnlocked(selectedGameMode)) {
      selectedGameMode = "standard";
    }
    selectedMissionId = "balanced";
    mapLocked = !!profile.config?.mapLocked;

    const run = profile.runState;
    if (run?.pathConfig?.routes?.length > 0 && run?.pathConfig?.spawnPoints?.length > 0) {
      pathMap = new PathMap(run.pathConfig);
      spawnPoints = pathMap.getSpawnPoints();
      buildPads = createBuildPadsFromGrid(pathMap);
    } else {
      pathMap = new PathMap(generatePathConfigForMode(rng, selectedDifficulty, selectedGameMode));
      spawnPoints = pathMap.getSpawnPoints();
      buildPads = createBuildPadsFromGrid(pathMap);
    }

    waveSpawner.clear();
    creeps.length = 0;
    towers.length = 0;
    for (const pad of buildPads) {
      pad.towerId = null;
    }

    const mission = missions[selectedMissionId];
    runBonuses = metaSystem.getRunBonuses(selectedDifficulty);
    activeDifficulty = selectedDifficulty;
    waveGenerator.difficulty = activeDifficulty;

    currentWaveLevel = safeInt(run?.currentWaveLevel, 0);
    totalKills = safeInt(run?.totalKills, 0);
    score = safeInt(run?.score, 0);
    gold = safeInt(run?.gold, getStartingGoldByDifficulty(activeDifficulty) + runBonuses.bonusStartingGold);
    portalLives = safeInt(run?.portalLives, getStartingLivesByDifficulty(activeDifficulty) + runBonuses.bonusPortalLives);
    stash = Array.isArray(run?.stash) ? run.stash : [];
    nextTowerNum = Math.max(1, safeInt(run?.nextTowerNum, 1));

    waveProgress.clear();
    for (const entry of run?.waveProgress ?? []) {
      const [level, progress] = entry;
      waveProgress.set(safeInt(level), {
        total: safeInt(progress?.total),
        killed: safeInt(progress?.killed),
        leaked: safeInt(progress?.leaked),
      });
    }
    generatedWaves.clear();
    for (const entry of run?.generatedWaves ?? []) {
      const [level, wave] = entry;
      generatedWaves.set(safeInt(level), wave);
    }
    completedWaveLevels.clear();
    for (const level of run?.completedWaveLevels ?? []) {
      completedWaveLevels.add(safeInt(level));
    }

    preWaveRemainingMs = Number.isFinite(run?.preWaveRemainingMs) ? run.preWaveRemainingMs : PRE_WAVE_DURATION_MS;
    preWaveActive = !!run?.preWaveActive;
    gameEnded = !!run?.gameEnded;
    victory = !!run?.victory;
    endlessMode = !!run?.endlessMode;
    awaitingVictoryChoice = !!run?.awaitingVictoryChoice;
    targetWave = safeInt(run?.targetWave, TARGET_WAVE_VICTORY) || TARGET_WAVE_VICTORY;
    runResolved = !!run?.runResolved;
    sessionElapsedSeconds = safeInt(run?.sessionElapsedSeconds, 0);
    sessionLastTimestamp = performance.now();
    currentBossPhase = safeInt(run?.currentBossPhase, 1) || 1;
    waveSpawnFinished = !!run?.waveSpawnFinished;

    for (const towerData of run?.towers ?? []) {
      const bp = TOWER_BLUEPRINTS[towerData.blueprintId];
      if (!bp) {
        continue;
      }
      const tower = new Tower({
        id: towerData.id,
        x: towerData.position?.x ?? 0,
        y: towerData.position?.y ?? 0,
        baseCost: bp.cost,
        investedGold: towerData.investedGold ?? bp.cost,
        range: towerData.baseRange ?? bp.range,
        damage: towerData.baseDamage ?? bp.damage,
        attackCd: towerData.baseAttackCd ?? bp.attackCd,
        damageType: bp.damageType,
        bonusDamageType: bp.bonusDamageType,
        color: bp.color,
        blueprintId: towerData.blueprintId,
        minAttackCd: bp.minAttackCd,
        xpBase: bp.xpBase,
        xpGrowth: bp.xpGrowth,
        specialText: bp.specialText,
        bonusSpecialText: bp.bonusSpecialText,
        hitsAllInRange: bp.hitsAllInRange,
        burnOnHit: bp.burnOnHit,
        maxTargetsPerShot: bp.maxTargetsPerShot,
        bonusMaxTargetsPerShot: bp.bonusMaxTargetsPerShot,
        splashRadius: bp.splashRadius,
        freezeDuration: bp.freezeDuration,
        bonusFreezeDuration: bp.bonusFreezeDuration,
        iceSlowDuration: bp.iceSlowDuration,
        iceSlowMul: bp.iceSlowMul,
        burnReductionOnFreezeHit: bp.burnReductionOnFreezeHit,
        burnReductionOnFreezeSplash: bp.burnReductionOnFreezeSplash,
        poisonOnHit: bp.poisonOnHit,
        poisonSlowDuration: bp.poisonSlowDuration,
        poisonSlowMul: bp.poisonSlowMul,
        splashDamageRatio: bp.splashDamageRatio,
        targetGroundOnly: bp.targetGroundOnly,
        targetAirOnly: bp.targetAirOnly,
        maxLevelStunChance: bp.maxLevelStunChance,
        stunDuration: bp.stunDuration,
        ricochetByLevel: bp.ricochetByLevel,
        ricochetRadius: bp.ricochetRadius,
        ricochetDamageRatio: bp.ricochetDamageRatio,
        ricochetMaxLevelBonus: bp.ricochetMaxLevelBonus,
        maxLevelMultiShot: bp.maxLevelMultiShot,
        hasEyes: towerData.hasEyes,
        revealInvisible: towerData.revealInvisible,
        bonusLevelThreshold: runBonuses.bonusLevelThreshold,
        maxLevel: runBonuses.towerMaxLevel,
        startLevel: Math.max(0, safeInt(towerData.level, 1)),
        itemSlots: bp.itemSlots,
        isAuraTower: bp.isAuraTower,
        footprintWidth: bp.footprintWidth,
        footprintHeight: bp.footprintHeight,
        initialAuraEffect: towerData.selectedAuraEffect ?? bp.initialAuraEffect,
        upgradeConfig: bp.upgrade,
        bus,
      });
      tower.xp = safeInt(towerData.xp, 0);
      tower.targetMode = towerData.targetMode ?? tower.targetMode;
      tower.padIds = Array.isArray(towerData.padIds) ? towerData.padIds : [];
      tower.items = Array.isArray(towerData.items) ? towerData.items : [];
      tower._rebuildItemBonuses?.();
      tower.setRunBonuses({
        damageMul: runBonuses.bonusTowerDamageMul,
        rangeMul: runBonuses.bonusTowerRangeMul,
        maxLevel: runBonuses.towerMaxLevel,
        revealInvisible: canTowerReveal(tower.blueprintId),
      });
      towers.push(tower);
      for (const padId of tower.padIds) {
        const pad = buildPads.find((entry) => entry.id === padId) ?? null;
        if (pad) {
          pad.towerId = tower.id;
        }
      }
    }

    for (const creepData of run?.creeps ?? []) {
      if (!creepData?.routeId || !creepData?.position) {
        continue;
      }
      const routeSpawn = spawnPoints.find((spawn) => spawn.routeId === creepData.routeId) ?? spawnPoints[0] ?? null;
      if (!routeSpawn) {
        continue;
      }
      const creep = new Creep({
        id: creepData.id,
        speed: Number.isFinite(creepData.baseSpeed) ? creepData.baseSpeed : creepData.speed,
        hp: creepData.hp,
        armor: creepData.armor,
        pathMap,
        bus,
        spawnPointId: routeSpawn.id,
        pathPoints: Array.isArray(creepData.pathPoints) ? creepData.pathPoints : null,
        waveType: creepData.waveType,
        armorType: creepData.armorType,
        leakDamage: creepData.leakDamage,
        bossMeta: creepData.bossMeta,
        affix: creepData.affix,
        specialEffects: creepData.specialEffects,
      });
      creep.restoreSnapshot?.(creepData);
      if (creep.isAlive()) {
        creeps.push(creep);
      }
    }

    if (waveSpawner.restoreSnapshot) {
      waveSpawner.restoreSnapshot(run?.waveSpawnerState ?? []);
    }

    buildMessage = `Profil chargé: ${activeProfileName} | ${selectedGameMode} | ${selectedDifficulty}`;
    showGameShell();
    hideRunOverlay();
    applyControlsUi();
  };

  const createAndStartProfile = ({ name, difficulty, gameMode }) => {
    const profile = saveProfileSystem.createProfile({ name, difficulty, gameMode });
    activeProfileId = profile.id;
    activeProfileName = profile.name;
    selectedDifficulty = profile.config.difficulty;
    selectedGameMode = profile.config.gameMode;
    selectedMissionId = "balanced";
    mapLocked = false;
    sessionElapsedSeconds = 0;
    sessionLastTimestamp = performance.now();
    metaSystem.state = {
      ...metaSystem.state,
      playerLevel: 0,
      playerXp: 0,
      sagessePoints: 0,
      runs: 0,
      wins: 0,
      totalKills: 0,
      bestWave: 0,
      highestWaveEver: 0,
      extremeUnlocked: false,
      knowledgeLevels: {
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
      },
      knowledgeUnlocked: { ...metaSystem.state.knowledgeUnlocked, reveal: false, linker: false, packArchitect: false },
    };
    metaSystem.save();
    syncMetaSnapshot();

    pathMap = new PathMap(generatePathConfigForMode(rng, selectedDifficulty, selectedGameMode));
    spawnPoints = pathMap.getSpawnPoints();
    buildPads = createBuildPadsFromGrid(pathMap);
    resetRun();
    saveActiveProfileSnapshot();
    showGameShell();
  };

  const openStartModal = () => {
    const unlocks = getModeUnlocks();
    const modeOptions = [
      { value: "standard", label: "Standard", disabled: false },
      { value: "triple", label: "Triple", disabled: !unlocks.tripleUnlocked },
      { value: "solo", label: "Solo", disabled: !unlocks.soloUnlocked },
    ];
    const difficultyOptions = getAvailableDifficulties();
    showModal(`
      <div class="menu-modal__backdrop"></div>
      <div class="menu-modal__card">
        <h3>Commencer une partie</h3>
        <label>Pseudo</label>
        <input id="startPseudoInput" type="text" maxlength="32" placeholder="Votre pseudo" />
        <label>Difficulté</label>
        <select id="startDifficultySelect">
          ${difficultyOptions.map((value) => `<option value="${value}">${getDifficultyLabel(value)}</option>`).join("")}
        </select>
        <label>Mode</label>
        <select id="startModeSelect">
          ${modeOptions
            .map((opt) => `<option value="${opt.value}" ${opt.disabled ? "disabled" : ""}>${opt.label}${opt.disabled ? " (verrouillé)" : ""}</option>`)
            .join("")}
        </select>
        <div class="menu-modal__actions">
          <button id="startCancelBtn" type="button">Annuler</button>
          <button id="startConfirmBtn" type="button">Démarrer</button>
        </div>
      </div>
    `);

    ui.modalLayer.querySelector("#startCancelBtn")?.addEventListener("click", () => hideModal());
    ui.modalLayer.querySelector("#startConfirmBtn")?.addEventListener("click", () => {
      const pseudo = ui.modalLayer.querySelector("#startPseudoInput")?.value ?? "joueur";
      const difficulty = ui.modalLayer.querySelector("#startDifficultySelect")?.value ?? "medium";
      const gameMode = ui.modalLayer.querySelector("#startModeSelect")?.value ?? "standard";
      createAndStartProfile({ name: pseudo, difficulty, gameMode });
      hideModal();
    });
  };

  const openContinueModal = () => {
    const profiles = saveProfileSystem.list();
    let selectedId = null;
    const listMarkup = profiles.length === 0
      ? '<div class="menu-modal__empty">Aucune partie existante.</div>'
      : profiles
        .map((profile) => `
          <button type="button" class="menu-modal__list-item" data-profile-id="${profile.id}" title="${escapeHtml(buildProfileTooltip(profile))}">
            <span>${escapeHtml(profile.name)}</span>
            <span>${escapeHtml(profile.config?.gameMode ?? "standard")} | ${escapeHtml(getDifficultyLabel(profile.config?.difficulty ?? "medium"))} | Vague ${profile.stats?.bestWave ?? 0}</span>
          </button>
        `)
        .join("");

    showModal(`
      <div class="menu-modal__backdrop"></div>
      <div class="menu-modal__card menu-modal__card--large">
        <h3>Continuer une partie</h3>
        <div class="menu-modal__list">${listMarkup}</div>
        <div class="menu-modal__actions">
          <button id="continueImportBtn" type="button">Importer</button>
          <button id="continueDeleteBtn" type="button" disabled>Supprimer</button>
          <button id="continueLoadBtn" type="button" disabled>Continuer</button>
          <button id="continueCloseBtn" type="button">Fermer</button>
        </div>
      </div>
    `);

    const deleteBtn = ui.modalLayer.querySelector("#continueDeleteBtn");
    const loadBtn = ui.modalLayer.querySelector("#continueLoadBtn");

    ui.modalLayer.querySelectorAll("[data-profile-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.profileId;
        ui.modalLayer.querySelectorAll("[data-profile-id]").forEach((entry) => entry.classList.remove("is-selected"));
        button.classList.add("is-selected");
        if (deleteBtn) {
          deleteBtn.disabled = false;
        }
        if (loadBtn) {
          loadBtn.disabled = false;
        }
      });
    });

    ui.modalLayer.querySelector("#continueCloseBtn")?.addEventListener("click", () => hideModal());
    ui.modalLayer.querySelector("#continueImportBtn")?.addEventListener("click", () => {
      ui.importSaveInput.value = "";
      ui.importSaveInput.click();
    });
    ui.modalLayer.querySelector("#continueDeleteBtn")?.addEventListener("click", () => {
      if (!selectedId) {
        return;
      }
      const profile = saveProfileSystem.getById(selectedId);
      if (!profile) {
        return;
      }
      showModal(`
        <div class="menu-modal__backdrop"></div>
        <div class="menu-modal__card">
          <h3>Confirmation</h3>
          <p>Supprimer la partie ${escapeHtml(profile.name)} ?</p>
          <div class="menu-modal__actions">
            <button id="confirmNoBtn" type="button">Annuler</button>
            <button id="confirmYesBtn" type="button">Supprimer</button>
          </div>
        </div>
      `);

      ui.modalLayer.querySelector("#confirmNoBtn")?.addEventListener("click", () => {
        hideModal();
        openContinueModal();
      });
      ui.modalLayer.querySelector("#confirmYesBtn")?.addEventListener("click", () => {
        saveProfileSystem.deleteProfile(selectedId);
        if (activeProfileId === selectedId) {
          activeProfileId = null;
          activeProfileName = "";
        }
        hideModal();
        showToast(`Partie supprimée: ${profile.name}`, "success");
        openContinueModal();
      });
    });
    ui.modalLayer.querySelector("#continueLoadBtn")?.addEventListener("click", () => {
      if (!selectedId) {
        return;
      }
      const profile = saveProfileSystem.getById(selectedId);
      loadProfileIntoRun(profile);
      hideModal();
      showToast(`Partie chargée: ${profile?.name ?? "profil"}`, "success");
    });
  };

  const getRewardGrowthByDifficulty = (difficulty) => {
    const value = String(difficulty ?? "medium").toLowerCase();
    if (value === "easy") {
      return 3;
    }
    if (value === "hard") {
      return 1.5;
    }
    if (value === "extreme") {
      return 1;
    }
    return 2;
  };

  const getEarlyLaunchBonusMultiplier = (difficulty) => {
    const value = String(difficulty ?? "medium").toLowerCase();
    if (value === "easy") {
      return 1;
    }
    if (value === "hard") {
      return 0.5;
    }
    if (value === "extreme") {
      return 0.75;
    }
    return 0.25;
  };

  const scoreBonus = (value) => Math.floor(value * runBonuses.bonusScoreMul);
  const getWaveCompletionReward = (waveLevel) => {
    const difficulty = String(activeDifficulty ?? "medium").toLowerCase();
    const growth = getRewardGrowthByDifficulty(difficulty);
    const level = Math.max(1, Math.floor(waveLevel));
    return Math.floor(10 + (level - 1) * growth);
  };

  const getBaseKillGoldForWave = (waveLevel, waveUnitCount) => {
    const level = Math.max(1, Math.floor(waveLevel));
    const unitCount = Math.max(1, Math.floor(waveUnitCount ?? 1));
    return Math.max(1, Math.floor((50 + (level - 1) * 10) / unitCount));
  };

  const getDifficultyLabel = (difficulty) => {
    if (difficulty === "easy") {
      return "facile";
    }
    if (difficulty === "hard") {
      return "difficile";
    }
    if (difficulty === "extreme") {
      return "extreme";
    }
    return "normal";
  };

  const getStartingGoldByDifficulty = (difficulty) => {
    if (difficulty === "easy") {
      return 300;
    }
    if (difficulty === "hard") {
      return 145;
    }
    if (difficulty === "extreme") {
      return 145;
    }
    return 198;
  };

  const getStartingLivesByDifficulty = (difficulty) => {
    if (difficulty === "easy") {
      return 50;
    }
    if (difficulty === "hard") {
      return 10;
    }
    if (difficulty === "extreme") {
      return 10;
    }
    return 23;
  };

  const getCurrentWaveRemainingRatio = () => {
    const progress = waveProgress.get(currentWaveLevel);
    if (!progress || progress.total <= 0) {
      return 1;
    }

    const remaining = Math.max(0, progress.total - progress.killed - (progress.leaked ?? 0));
    return Math.max(0, Math.min(1, remaining / progress.total));
  };

  const getEarlyLaunchBonusPreview = () => {
    const nextWaveReward = getWaveCompletionReward(currentWaveLevel + 1);
    return Math.floor(
      nextWaveReward * getCurrentWaveRemainingRatio() * getEarlyLaunchBonusMultiplier(activeDifficulty),
    );
  };

  const showRunOverlay = (state, summary, options = {}) => {
    ui.runOverlay.classList.remove("hidden");
    ui.runOverlay.dataset.state = state;
    const actionsMarkup = options.showContinueChoice
      ? `
        <div class="run-overlay__actions">
          <button id="overlayContinueBtn" type="button">Continuer</button>
          <button id="overlayQuitBtn" type="button">Quitter</button>
        </div>
      `
      : "";
    ui.runOverlay.innerHTML = `
      <div class="run-overlay__card">
        <div class="run-overlay__title">${state === "victory" ? "Victoire" : "Défaite"}</div>
        <div class="run-overlay__summary">${summary}</div>
        <div class="run-overlay__meta">Meta level ${meta.playerLevel} | Sagesse ${meta.sagessePoints} | Runs ${meta.runs} | Wins ${meta.wins} | Best wave ${meta.bestWave}</div>
        <div class="run-overlay__hint">Appuie sur R pour relancer</div>
        ${actionsMarkup}
      </div>
    `;
  };

  const hideRunOverlay = () => {
    ui.runOverlay.classList.add("hidden");
    ui.runOverlay.innerHTML = "";
  };

  const currentMission = () => missions[selectedMissionId];

  const getPlayerProgressTooltip = () => {
    const xp = metaSystem.getPlayerXpProgress();
    return {
      title: `Niveau joueur ${xp.currentLevel}`,
      lines: [
        `Progression: ${Math.round(xp.ratio * 100)}%`,
        `XP: ${xp.currentXp}/${xp.nextLevelXp}`,
        `Prochain niveau: ${xp.currentLevel + 1}`,
        `Runs: ${meta.runs ?? 0}`,
        `Kills totaux: ${meta.totalKills ?? 0}`,
        `Meilleure vague: ${meta.bestWave ?? 0}`,
      ],
      accent: "#4ec9b0",
    };
  };

  const getKnowledgePanelStateKey = () =>
    JSON.stringify({
      sagessePoints: meta.sagessePoints,
      selectedDifficulty,
      activeDifficulty,
      knowledgeLevels: meta.knowledgeLevels,
      knowledgeUnlocked: meta.knowledgeUnlocked,
    });

  const maybeRefreshKnowledgePanel = () => {
    if (!isKnowledgePanelOpen()) {
      return;
    }

    const nextKey = getKnowledgePanelStateKey();
    if (nextKey !== knowledgePanelStateKey) {
      renderKnowledgePanel();
    }
  };

  const positionInfoHoverCard = (event) => {
    const card = ui.infoHoverCard;
    const offset = 18;
    const maxLeft = window.innerWidth - card.offsetWidth - 12;
    const maxTop = window.innerHeight - card.offsetHeight - 12;
    const left = Math.min(maxLeft, event.clientX + offset);
    const top = Math.min(maxTop, event.clientY + offset);
    card.style.left = `${Math.max(12, left)}px`;
    card.style.top = `${Math.max(12, top)}px`;
  };

  const showInfoHoverCard = ({ title, lines = [], accent = "#93c5fd" }, event) => {
    ui.infoHoverCard.style.setProperty("--info-accent", accent);
    ui.infoHoverCard.innerHTML = `
      <div class="info-hover-card__title">${title}</div>
      ${lines.map((line) => `<div class="info-hover-card__line">${line}</div>`).join("")}
    `;
    ui.infoHoverCard.classList.remove("hidden");
    ui.infoHoverCard.setAttribute("aria-hidden", "false");
    positionInfoHoverCard(event);
  };

  const hideInfoHoverCard = () => {
    ui.infoHoverCard.classList.add("hidden");
    ui.infoHoverCard.setAttribute("aria-hidden", "true");
  };

  const getActiveKnowledgeDifficulty = () => String(activeDifficulty ?? selectedDifficulty ?? "medium").toLowerCase();

  const getRevealTowerIdsByDifficulty = (difficulty = getActiveKnowledgeDifficulty()) => {
    const normalized = String(difficulty ?? "medium").toLowerCase();
    const revealIds = new Set(["pyro", "frozen", "ronce", "scorpio"]);
    if (normalized === "medium") {
      revealIds.add("arc");
    }
    if (normalized === "easy") {
      revealIds.add("arc");
      revealIds.add("sentinel");
    }
    return Array.from(revealIds);
  };

  const canTowerReveal = (towerId) => {
    if (!runBonuses.revealUnlocked) {
      return false;
    }

    return getRevealTowerIdsByDifficulty().includes(towerId);
  };

  const getSelectedBuildPosition = () => {
    const selectedPad = selectedPadId ? buildPads.find((pad) => pad.id === selectedPadId) ?? null : null;
    return selectedPad && !selectedPad.towerId ? { x: selectedPad.x, y: selectedPad.y } : null;
  };

  const getTowerPurchaseCost = (towerId, position = getSelectedBuildPosition()) => {
    const baseCost = TOWER_BLUEPRINTS[towerId]?.cost ?? 0;
    const reduceMul = position ? getAuraReduceMultiplierAtPosition(position) : 1;
    return Math.max(1, Math.floor(baseCost * (runBonuses.bonusTowerCostMul ?? 1) * reduceMul));
  };

  const isPackArchitectTower = (towerId) => ["ricochet", "machinegun", "aura"].includes(String(towerId ?? "").toLowerCase());

  const isTowerUnlockedByKnowledge = (towerId) => {
    if (!TOWER_BLUEPRINTS[towerId]) {
      return false;
    }
    if (!isPackArchitectTower(towerId)) {
      return true;
    }
    return !!runBonuses.packArchitectUnlocked;
  };

  const getKnowledgeDefinitions = () => ({
    economy: { label: "economy", cost: 1, maxLevel: Number.POSITIVE_INFINITY, describe: () => "Ajoute de l'or au debut du prochain run." },
    offense: { label: "offense", cost: 1, maxLevel: Number.POSITIVE_INFINITY, describe: () => "Augmente les degats de toutes les tours." },
    defense: { label: "defense", cost: 1, maxLevel: Number.POSITIVE_INFINITY, describe: () => "Augmente les vies du portail." },
    merchant: { label: "merchant", cost: 4, maxLevel: 20, describe: () => "Reduit le cout d'achat des tours, pas des ameliorations." },
    watchman: { label: "watchman", cost: 2, maxLevel: 50, describe: () => "Augmente la portee de vos tours." },
    brisk: { label: "brisk", cost: 2, maxLevel: 50, describe: () => "Augmente la vitesse d'attaque de vos tours." },
    experienced: { label: "experienced", cost: 2, maxLevel: 50, describe: () => "Augmente l'experience recue par les tours sur kill." },
    scored: { label: "scored", cost: 3, maxLevel: Number.POSITIVE_INFINITY, describe: () => "Augmente les gains de score / XP joueur." },
    investor: { label: "investor", cost: 5, maxLevel: 10, describe: () => "Augmente l'or gagne sur chaque kill." },
    builder: { label: "builder", cost: 20, maxLevel: 40, describe: () => "Augmente le niveau max reel des tours, sans changer les bonus du niveau 10." },
    shop: { label: "shop", cost: 10, maxLevel: 20, describe: () => "Debloque la boutique puis reduit le prix des objets et ouvre de nouvelles lignes." },
    reveal: { label: "reveal", cost: 100, oneShot: true, describe: () => "Certaines tours niveau 10 revelent les creeps invisibles dans leur portee." },
    linker: { label: "linker", cost: 200, oneShot: true, describe: () => "Transfere l'XP perdue d'une tour capee vers la tour eligible la plus proche." },
    packArchitect: { label: "pack architect", cost: 300, oneShot: true, describe: () => "Debloque un futur pack de tours." },
  });

  const getKnowledgeTooltip = (key, currentLevel = 0) => {
    const difficulty = getActiveKnowledgeDifficulty();
    const tier = difficulty === "easy" ? "easy" : difficulty === "hard" || difficulty === "extreme" ? "hard" : "medium";
    const nextLevel = currentLevel + 1;

    if (key === "economy") {
      const value = tier === "easy" ? 24 : tier === "hard" ? 6 : 12;
      return `Niveau suivant: +${value} or au debut du prochain run.`;
    }
    if (key === "offense") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% degats tours. Niveau apres achat: ${nextLevel}.`;
    }
    if (key === "defense") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value} vies portail.`;
    }
    if (key === "merchant") {
      const value = tier === "easy" ? 2 : tier === "hard" ? 0.5 : 1;
      return `Niveau suivant: -${value}% cout d'achat des tours.`;
    }
    if (key === "shop") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      const afterLevel = nextLevel;
      const unlockText = afterLevel === 1
        ? " Debloque la boutique."
        : afterLevel === 10
          ? " Debloque la 2e ligne de produits."
          : afterLevel === 20
            ? " Debloque la 3e ligne de produits."
            : "";
      return `Niveau suivant: -${value}% cout des objets de boutique.${unlockText}`;
    }
    if (key === "watchman") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% portee tours.`;
    }
    if (key === "brisk") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% vitesse d'attaque tours.`;
    }
    if (key === "experienced") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% XP tours sur kill.`;
    }
    if (key === "scored") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% gains de score / XP joueur.`;
    }
    if (key === "investor") {
      const value = tier === "easy" ? 3 : tier === "hard" ? 1 : 2;
      return `Niveau suivant: +${value}% or sur kill.`;
    }
    if (key === "builder") {
      return `Niveau suivant: cap reel des tours = ${10 + nextLevel}. Les bonus speciaux restent declenches au niveau 10.`;
    }
    if (key === "reveal") {
      const labels = getRevealTowerIdsByDifficulty(difficulty)
        .map((towerId) => TOWER_BLUEPRINTS[towerId]?.label ?? towerId)
        .join(", ");
      return `Debloque la revelation des creeps invisibles par certaines tours niveau 10 selon la difficulte. Tours concernees: ${labels}.`;
    }
    if (key === "linker") {
      return `Debloque le transfert d'XP perdue des tours capees dans un rayon de ${runBonuses.linkerRadius}.`;
    }
    if (key === "packArchitect") {
      return "Debloque un futur pack de tours.";
    }
    return "Connaissance";
  };

  const isKnowledgePanelOpen = () => !ui.knowledgePanel.classList.contains("hidden");

  const applyRunBonusesToState = (previousBonuses = null) => {
    const previousPortalBonus = previousBonuses?.bonusPortalLives ?? 0;
    runBonuses = metaSystem.getRunBonuses(activeDifficulty);

    if (runBonuses.bonusPortalLives > previousPortalBonus) {
      portalLives += runBonuses.bonusPortalLives - previousPortalBonus;
    }

    for (const tower of towers) {
      tower.setRunBonuses({
        damageMul: runBonuses.bonusTowerDamageMul,
        rangeMul: runBonuses.bonusTowerRangeMul,
        attackSpeedMul: runBonuses.bonusTowerAttackSpeedMul,
        maxLevel: runBonuses.towerMaxLevel,
        revealInvisible: canTowerReveal(tower.blueprintId),
      });
    }
  };

  const renderKnowledgePanel = () => {
    const defs = getKnowledgeDefinitions();
    const difficulty = getActiveKnowledgeDifficulty();
    const buildEntry = ([key, def]) => {
      const currentLevel = meta.knowledgeLevels?.[key] ?? 0;
      const unlocked = meta.knowledgeUnlocked?.[key] ?? false;
      const effectiveCost = difficulty === "extreme" ? def.cost * 2 : def.cost;
      const isMaxed = !def.oneShot && Number.isFinite(def.maxLevel) && currentLevel >= def.maxLevel;
      const disabled = def.oneShot
        ? unlocked || meta.sagessePoints < effectiveCost
        : isMaxed || meta.sagessePoints < effectiveCost;
      const levelText = def.oneShot
        ? unlocked
          ? "active"
          : "one-shot"
        : Number.isFinite(def.maxLevel)
          ? `niv ${currentLevel}/${def.maxLevel}`
          : `niv ${currentLevel}`;

      return `
        <button
          type="button"
          class="knowledge-panel__entry${disabled ? " knowledge-panel__entry--disabled" : ""}${unlocked ? " knowledge-panel__entry--active" : ""}"
          data-knowledge-key="${key}"
          data-knowledge-tooltip="${escapeHtml(getKnowledgeTooltip(key, currentLevel))}"
          ${disabled ? "disabled" : ""}
        >
          <span class="knowledge-panel__entry-title">${def.label}</span>
          <span class="knowledge-panel__entry-meta">cout ${effectiveCost} sagesse | ${levelText}</span>
        </button>
      `;
    };

    const cumulativeEntries = Object.entries(defs)
      .filter(([, def]) => !def.oneShot)
      .map(buildEntry)
      .join("");
    const oneShotEntries = Object.entries(defs)
      .filter(([, def]) => def.oneShot)
      .map(buildEntry)
      .join("");

    ui.knowledgePanel.innerHTML = `
      <div class="knowledge-panel__card">
        <div class="knowledge-panel__header">
          <div>
            <div class="knowledge-panel__title">Connaissances</div>
            <div class="knowledge-panel__points">Sagesse disponible: ${meta.sagessePoints}</div>
          </div>
          <button id="knowledgeCloseBtn" type="button">Fermer</button>
        </div>
        <div class="knowledge-panel__section-title">Connaissances cumulables</div>
        <div class="knowledge-panel__grid">${cumulativeEntries}</div>
        <div class="knowledge-panel__section-title">Connaissances one-shot</div>
        <div class="knowledge-panel__grid">${oneShotEntries}</div>
      </div>
    `;

    knowledgePanelStateKey = getKnowledgePanelStateKey();

    const closeButton = ui.knowledgePanel.querySelector("#knowledgeCloseBtn");
    closeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleKnowledgePanel(false);
    });
  };

  const toggleKnowledgePanel = (open = !isKnowledgePanelOpen()) => {
    ui.knowledgePanel.classList.toggle("hidden", !open);
    if (open) {
      renderKnowledgePanel();
      return;
    }
    knowledgePanelStateKey = "";
  };

  const purchaseKnowledge = (key) => {
    const defs = getKnowledgeDefinitions();
    const def = defs[key];
    if (!def) {
      return false;
    }

    const previousBonuses = { ...runBonuses };
    const ok = metaSystem.purchaseKnowledge(key, {
      cost: def.cost,
      maxLevel: def.maxLevel,
      oneShot: !!def.oneShot,
      difficulty: getActiveKnowledgeDifficulty(),
    });
    if (!ok) {
      return false;
    }

    syncMetaSnapshot();
    applyRunBonusesToState(previousBonuses);
    saveActiveProfileSnapshot();
    if (key === "shop") {
      repriceShopInventory();
      ensureShopInventoryForUnlockedRows();
      refreshInventoryPanelIfOpen();
    }
    renderKnowledgePanel();
    buildMessage = `Connaissance achetee: ${def.label}`;
    applyControlsUi();
    return true;
  };

  const getTowerTooltip = (towerType) => {
    const bp = TOWER_BLUEPRINTS[towerType];
    if (!bp) {
      return "Tour inconnue";
    }
    if (bp.isAuraTower) {
      return `Tour ${bp.label} | Cout ${getTowerPurchaseCost(towerType)} or | Portee ${bp.range} | Niveau 0 | Support 2x2 | Effet selectionnable avant niveau 1`;
    }
    const dps = bp.damage / bp.attackCd;
    return `Tour ${bp.label} | Cout ${getTowerPurchaseCost(towerType)} or | Dmg ${bp.damage} | Rng ${bp.range} | DPS ${dps.toFixed(1)} | ${bp.specialText ?? "Standard"}`;
  };

  const SHOP_RESTOCK_COST = 1000;
  const SHOP_ROW_COUNT = 3;
  const SHOP_COL_COUNT = 3;
  const SHOP_LIFE_COST = 500;
  const SHOP_WISDOM_COST = 1500;
  const SHOP_GOLD_COST = 0;

  const SHOP_SPECIAL_OFFERS = {
    life1: { id: "offer-life-1", type: "life", amount: 1, name: "+1 vie", rarity: "special", cost: SHOP_LIFE_COST },
    life2: { id: "offer-life-2", type: "life", amount: 2, name: "+2 vies", rarity: "special", cost: SHOP_LIFE_COST * 2 },
    wisdom1: { id: "offer-wisdom-1", type: "wisdom", amount: 1, name: "+1 sagesse", rarity: "special", cost: SHOP_WISDOM_COST },
    gold750: { id: "offer-gold-750", type: "gold", amount: 750, name: "+750 or", rarity: "special", cost: SHOP_GOLD_COST },
  };

  const SHOP_SLOT_WEIGHT_RULES = {
    0: {
      0: [{ key: "common", weight: 75 }, { key: "uncommon", weight: 25 }],
      1: [{ key: "uncommon", weight: 60 }, { key: "rare", weight: 35 }, { key: "legendary", weight: 5 }],
      2: [{ key: "rare", weight: 70 }, { key: "legendary", weight: 24 }, { key: "unique", weight: 6 }],
    },
    1: {
      0: [{ key: "common", weight: 50 }, { key: "uncommon", weight: 44 }, { key: "rare", weight: 5 }, { key: "legendary", weight: 1 }],
      1: [{ key: "uncommon", weight: 50 }, { key: "rare", weight: 45 }, { key: "legendary", weight: 5 }],
      2: [{ key: "rare", weight: 75 }, { key: "legendary", weight: 24 }, { key: "unique", weight: 1 }],
    },
    2: {
      0: [{ key: "rare", weight: 10 }, { key: "legendary", weight: 60 }, { key: "unique", weight: 25 }, { key: "life1", weight: 5 }],
      1: [{ key: "legendary", weight: 20 }, { key: "life1", weight: 20 }, { key: "unique", weight: 20 }, { key: "wisdom1", weight: 15 }, { key: "gold750", weight: 25 }],
      2: [{ key: "unique", weight: 25 }, { key: "gold750", weight: 25 }, { key: "life2", weight: 15 }, { key: "life1", weight: 20 }, { key: "wisdom1", weight: 15 }],
    },
  };
  const shopInventory = Array.from({ length: SHOP_ROW_COUNT * SHOP_COL_COUNT }, () => undefined);
  const STASH_SORT_MODES = ["rarity", "power", "range", "speed"];

  const sortStash = () => {
    const compareByName = (left, right) =>
      String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "fr", { sensitivity: "base" });
    const compareByRarity = (left, right) => ItemSystem.compareItemsByRarity(left, right);

    if (stashSortMode === "power") {
      stash = [...stash].sort((left, right) => {
        const diff = Number(right?.modifiers?.damageMul ?? 1) - Number(left?.modifiers?.damageMul ?? 1);
        if (Math.abs(diff) > 0.0001) {
          return diff;
        }
        const rarityOrder = compareByRarity(left, right);
        return rarityOrder !== 0 ? rarityOrder : compareByName(left, right);
      });
      return;
    }

    if (stashSortMode === "range") {
      stash = [...stash].sort((left, right) => {
        const diff = Number(right?.modifiers?.rangeFlat ?? 0) - Number(left?.modifiers?.rangeFlat ?? 0);
        if (diff !== 0) {
          return diff;
        }
        const rarityOrder = compareByRarity(left, right);
        return rarityOrder !== 0 ? rarityOrder : compareByName(left, right);
      });
      return;
    }

    if (stashSortMode === "speed") {
      stash = [...stash].sort((left, right) => {
        const diff = Number(right?.modifiers?.attackSpeedMul ?? 1) - Number(left?.modifiers?.attackSpeedMul ?? 1);
        if (Math.abs(diff) > 0.0001) {
          return diff;
        }
        const rarityOrder = compareByRarity(left, right);
        return rarityOrder !== 0 ? rarityOrder : compareByName(left, right);
      });
      return;
    }

    stash = ItemSystem.sortItems(stash);
  };

  const getStashSortLabel = () => {
    if (stashSortMode === "power") {
      return "Puissance";
    }
    if (stashSortMode === "range") {
      return "Portée";
    }
    if (stashSortMode === "speed") {
      return "Vitesse";
    }
    return "Rareté";
  };

  const getItemSellValue = (item) => {
    const explicitBonus = Number(item?.sellValueBonus ?? 0);
    const rarity = String(item?.rarity ?? "common").toLowerCase();
    if (rarity === "unique") {
      return 360 + explicitBonus;
    }
    if (rarity === "legendary") {
      return 210 + explicitBonus;
    }
    if (rarity === "rare") {
      return 80 + explicitBonus;
    }
    if (rarity === "uncommon") {
      return 36 + explicitBonus;
    }
    return 16 + explicitBonus;
  };

  const getShopKnowledgeLevel = () => Math.max(0, Math.floor(runBonuses.shopLevel ?? meta.knowledgeLevels?.shop ?? 0));

  const isShopUnlocked = () => getShopKnowledgeLevel() > 0;

  const getUnlockedShopRows = (shopLevel = getShopKnowledgeLevel()) => {
    if (shopLevel >= 20) {
      return 3;
    }
    if (shopLevel >= 10) {
      return 2;
    }
    if (shopLevel >= 1) {
      return 1;
    }
    return 0;
  };

  const getShopItemCost = (item) => {
    if (String(item?.rarity ?? "").toLowerCase() === "special") {
      return Math.max(0, Math.floor((item?.cost ?? 0) * (runBonuses.bonusShopCostMul ?? 1)));
    }
    return Math.max(1, Math.floor(getItemSellValue(item) * 3 * (runBonuses.bonusShopCostMul ?? 1)));
  };

  const rollFromWeights = (entries) => {
    const pool = Array.isArray(entries) ? entries.filter((entry) => (entry?.weight ?? 0) > 0) : [];
    if (pool.length === 0) {
      return null;
    }
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng.range(0, total);
    for (const entry of pool) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.key;
      }
    }
    return pool[pool.length - 1]?.key ?? null;
  };

  const buildShopSlotItem = (slotIndex) => {
    const rowIndex = Math.floor(slotIndex / SHOP_COL_COUNT);
    const colIndex = slotIndex % SHOP_COL_COUNT;
    const rule = SHOP_SLOT_WEIGHT_RULES[rowIndex]?.[colIndex] ?? SHOP_SLOT_WEIGHT_RULES[0]?.[0] ?? [];
    const rolledKey = rollFromWeights(rule);
    if (!rolledKey) {
      return null;
    }

    let item = null;
    if (SHOP_SPECIAL_OFFERS[rolledKey]) {
      item = {
        ...SHOP_SPECIAL_OFFERS[rolledKey],
        id: `${SHOP_SPECIAL_OFFERS[rolledKey].id}-${Math.floor(rng.range(1000, 9999))}`,
      };
    } else {
      item = itemSystem.buildShopItemByRarity(rolledKey, `r${rowIndex + 1}c${colIndex + 1}`, {
        excludedUniqueSourceIds: getOwnedUniqueSourceIds({ includeShop: true }),
        uniqueFallbackMode: "shop",
      });
    }
    if (!item) {
      return null;
    }
    item.cost = getShopItemCost(item);
    return item;
  };

  const repriceShopInventory = () => {
    for (let index = 0; index < shopInventory.length; index += 1) {
      const item = shopInventory[index];
      if (item) {
        item.cost = getShopItemCost(item);
      }
    }
  };

  const ensureShopInventoryForUnlockedRows = () => {
    const unlockedRows = getUnlockedShopRows();
    for (let rowIndex = 0; rowIndex < unlockedRows; rowIndex += 1) {
      for (let colIndex = 0; colIndex < SHOP_COL_COUNT; colIndex += 1) {
        const slotIndex = rowIndex * SHOP_COL_COUNT + colIndex;
        if (shopInventory[slotIndex] === undefined) {
          shopInventory[slotIndex] = buildShopSlotItem(slotIndex);
        }
      }
    }
  };

  const rerollShopInventory = () => {
    const unlockedRows = getUnlockedShopRows();
    for (let slotIndex = 0; slotIndex < shopInventory.length; slotIndex += 1) {
      const rowIndex = Math.floor(slotIndex / SHOP_COL_COUNT);
      shopInventory[slotIndex] = rowIndex < unlockedRows ? buildShopSlotItem(slotIndex) : undefined;
    }
  };

  const getTowerById = (towerId) => towers.find((tower) => tower.id === towerId) ?? null;

  const getOwnedUniqueSourceIds = ({ includeShop = false } = {}) => {
    const ids = new Set();
    for (const item of stash) {
      if (String(item?.rarity ?? "").toLowerCase() === "unique" && item?.sourceId) {
        ids.add(String(item.sourceId));
      }
    }
    for (const tower of towers) {
      for (const item of tower.items ?? []) {
        if (String(item?.rarity ?? "").toLowerCase() === "unique" && item?.sourceId) {
          ids.add(String(item.sourceId));
        }
      }
    }
    if (includeShop) {
      for (const item of shopInventory) {
        if (String(item?.rarity ?? "").toLowerCase() === "unique" && item?.sourceId) {
          ids.add(String(item.sourceId));
        }
      }
    }
    return ids;
  };

  const resetManualItemFlow = () => {
    pendingTowerItemTargetId = null;
    pendingTowerSelectionItemId = null;
  };

  const isManualItemFlowActive = () => !!pendingTowerItemTargetId || !!pendingTowerSelectionItemId;

  const pushItemToStash = (item) => {
    if (!item) {
      return;
    }
    let nextItem = item;
    if (String(item?.rarity ?? "").toLowerCase() === "unique" && item?.sourceId) {
      const ownedUniqueIds = getOwnedUniqueSourceIds();
      if (ownedUniqueIds.has(String(item.sourceId))) {
        nextItem = itemSystem.buildReplacementUnique(ownedUniqueIds, "item-reroll");
      }
    }
    if (!nextItem) {
      buildMessage = "Aucun autre objet unique disponible";
      applyControlsUi();
      return;
    }
    stash.push(nextItem);
    sortStash();
    refreshInventoryPanelIfOpen();
  };

  const takeStashItemAt = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= stash.length) {
      return null;
    }
    const [item] = stash.splice(index, 1);
    sortStash();
    refreshInventoryPanelIfOpen();
    return item ?? null;
  };

  const equipStashItemToTower = (index, towerId) => {
    const tower = getTowerById(towerId);
    if (!tower) {
      buildMessage = "Tour introuvable";
      return false;
    }
    if (!tower.canAddItem()) {
      buildMessage = `${tower.id} a un inventaire plein`;
      return false;
    }

    const item = takeStashItemAt(index);
    if (!item) {
      buildMessage = "Objet introuvable";
      return false;
    }

    const added = tower.addItem(item);
    if (!added) {
      pushItemToStash(item);
      buildMessage = `${tower.id} ne peut pas recevoir cet objet`;
      return false;
    }

    buildMessage = `${tower.id} équipe ${item.name}`;
    resetManualItemFlow();
    refreshRuntimeUi();
    return true;
  };

  const removeTowerItemToStash = (towerId, itemIndex) => {
    const tower = getTowerById(towerId);
    if (!tower) {
      return false;
    }
    const item = tower.removeItemAt(itemIndex);
    if (!item) {
      return false;
    }
    pushItemToStash(item);
    buildMessage = `${tower.id} retire ${item.name}`;
    refreshRuntimeUi();
    return true;
  };

  const sellStashItem = (index) => {
    const item = takeStashItemAt(index);
    if (!item) {
      return false;
    }
    const value = getItemSellValue(item);
    gold += value;
    buildMessage = `${item.name} vendu (+${value} or)`;
    applyControlsUi();
    return true;
  };

  const cycleStashSortMode = () => {
    const currentIndex = STASH_SORT_MODES.indexOf(stashSortMode);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % STASH_SORT_MODES.length : 0;
    stashSortMode = STASH_SORT_MODES[nextIndex];
    sortStash();
    refreshInventoryPanelIfOpen();
    buildMessage = `Tri inventaire: ${getStashSortLabel()}`;
    applyControlsUi();
  };

  const autoAssignStashItems = () => {
    if (stash.length === 0) {
      buildMessage = "Inventaire joueur vide";
      return false;
    }

    sortStash();
    let assignedCount = 0;
    for (const tower of towers) {
      while (tower.canAddItem() && stash.length > 0) {
        const item = stash.shift();
        if (!item) {
          break;
        }
        const added = tower.addItem(item);
        if (!added) {
          stash.unshift(item);
          break;
        }
        assignedCount += 1;
      }
    }

    sortStash();
    refreshInventoryPanelIfOpen();
    refreshRuntimeUi();
    buildMessage = assignedCount > 0
      ? `${assignedCount} objets auto-assignés selon le tri ${getStashSortLabel().toLowerCase()}`
      : "Aucune tour n'a de place pour un objet";
    return assignedCount > 0;
  };

  const sellAllStashItems = () => {
    if (stash.length === 0) {
      buildMessage = "Inventaire joueur vide";
      return false;
    }

    const soldCount = stash.length;
    const totalValue = stash.reduce((sum, item) => sum + getItemSellValue(item), 0);
    stash = [];
    gold += totalValue;
    refreshInventoryPanelIfOpen();
    buildMessage = `${soldCount} objets vendus (+${totalValue} or)`;
    applyControlsUi();
    return true;
  };

  const buyShopItem = (index) => {
    const shopItem = shopInventory[index] ?? null;
    if (!shopItem) {
      return false;
    }
    if (gold < shopItem.cost) {
      buildMessage = `Or insuffisant (${gold}/${shopItem.cost})`;
      return false;
    }
    gold -= shopItem.cost;

    if (String(shopItem?.rarity ?? "").toLowerCase() === "special") {
      if (shopItem.type === "life") {
        portalLives += Math.max(0, Math.floor(shopItem.amount ?? 0));
      } else if (shopItem.type === "wisdom") {
        metaSystem.state.sagessePoints += Math.max(0, Math.floor(shopItem.amount ?? 0));
        metaSystem.save();
        syncMetaSnapshot();
      } else if (shopItem.type === "gold") {
        gold += Math.max(0, Math.floor(shopItem.amount ?? 0));
      }
      shopInventory[index] = null;
      buildMessage = `${shopItem.name} acheté (${shopItem.cost === 0 ? "gratuit" : `-${shopItem.cost} or`})`;
      refreshInventoryPanelIfOpen();
      applyControlsUi();
      return true;
    }

    const purchased = {
      id: `bought-${shopItem.sourceId}-${Math.floor(rng.range(1000, 9999))}`,
      sourceId: shopItem.sourceId,
      name: shopItem.name,
      rarity: shopItem.rarity,
      modifiers: { ...shopItem.modifiers },
      cost: shopItem.cost,
    };
    shopInventory[index] = null;
    pushItemToStash(purchased);
    buildMessage = `${purchased.name} acheté (-${shopItem.cost} or)`;
    applyControlsUi();
    return true;
  };

  const restockShopInventory = () => {
    if (!isShopUnlocked()) {
      buildMessage = "Boutique verrouillée";
      return false;
    }
    if (gold < SHOP_RESTOCK_COST) {
      buildMessage = `Or insuffisant (${gold}/${SHOP_RESTOCK_COST})`;
      return false;
    }

    gold -= SHOP_RESTOCK_COST;
    rerollShopInventory();
    refreshInventoryPanelIfOpen();
    buildMessage = `Stocks réapprovisionnés (-${SHOP_RESTOCK_COST} or)`;
    applyControlsUi();
    return true;
  };

  const getItemRarityLabel = (item) => {
    const rarity = String(item?.rarity ?? "common").toLowerCase();
    if (rarity === "special") {
      return "offre";
    }
    if (rarity === "common") {
      return "commun";
    }
    if (rarity === "uncommon") {
      return "peu commun";
    }
    if (rarity === "rare") {
      return "rare";
    }
    if (rarity === "legendary") {
      return "légendaire";
    }
    if (rarity === "unique") {
      if (item?.isReserveUniqueLegendary) {
        return "unique légendaire";
      }
      return "unique";
    }
    return rarity;
  };

  const getItemAccent = (item) => {
    if (item?.isReserveUniqueLegendary) {
      return "#dc2626";
    }
    const rarity = String(item?.rarity ?? "common").toLowerCase();
    if (rarity === "uncommon") {
      return "#4ec9b0";
    }
    if (rarity === "rare") {
      return "#60a5fa";
    }
    if (rarity === "legendary") {
      return "#f97316";
    }
    if (rarity === "unique") {
      return "#f59e0b";
    }
    return "#94a3b8";
  };

  const getItemEffects = (item) => {
    const modifiers = item?.modifiers ?? {};
    const lines = [];
    const damageMul = Number(modifiers.damageMul ?? 1);
    const rangeFlat = Number(modifiers.rangeFlat ?? 0);
    const attackSpeedMul = Number(modifiers.attackSpeedMul ?? 1);

    if (damageMul !== 1) {
      const pct = Math.round((damageMul - 1) * 100);
      lines.push(`Degats ${pct >= 0 ? "+" : ""}${pct}%`);
    }
    if (rangeFlat !== 0) {
      lines.push(`Portee ${rangeFlat >= 0 ? "+" : ""}${rangeFlat}`);
    }
    if (attackSpeedMul !== 1) {
      const pct = Math.round((attackSpeedMul - 1) * 100);
      lines.push(`Vitesse ${pct >= 0 ? "+" : ""}${pct}%`);
    }

    if (lines.length === 0) {
      lines.push("Aucun effet actif");
    }

    return lines;
  };

  const getItemTooltip = (item, contextText = "") => {
    if (String(item?.rarity ?? "").toLowerCase() === "special") {
      let definition = "Objet de boutique.";
      if (item?.type === "wisdom") {
        definition = "Ajoute un nouveau point de sagesse a votre reserve.";
      } else if (item?.type === "life") {
        definition = Number(item?.amount ?? 0) >= 2
          ? "Ajoute deux vies pour ce run (n'augmente pas les vies de depart pour les runs suivants)."
          : "Ajoute une vie pour ce run (n'augmente pas les vies de depart pour les runs suivants).";
      } else if (item?.type === "gold") {
        definition = "Un petit coup de pouce, on ne dit pas non ^^.";
      }

      return {
        title: String(item?.name ?? "Objet"),
        lines: [definition],
        accent: getItemAccent(item),
      };
    }

    const lines = [`Rareté: ${getItemRarityLabel(item)}`];
    if (contextText) {
      lines.push(contextText);
    }
    lines.push(...getItemEffects(item));
    return {
      title: String(item?.name ?? "Objet"),
      lines,
      accent: getItemAccent(item),
    };
  };

  const renderItemChip = (item, index, source, metaText = "") => {
    const rarity = String(item?.rarity ?? "common").toLowerCase();
    return `
      <button
        type="button"
        class="item-chip item-chip--${escapeHtml(rarity)}"
        style="--item-accent: ${escapeHtml(getItemAccent(item))}"
        data-item-source="${escapeHtml(source)}"
        data-item-index="${index}"
      >
        <span class="item-chip__name">${escapeHtml(item?.name ?? "Objet")}</span>
        <span class="item-chip__meta">${escapeHtml(metaText || getItemRarityLabel(item))}</span>
      </button>
    `;
  };

  const renderItemActionButton = (label, action, source, index, extraAttrs = "") => `
    <button
      type="button"
      class="item-action-btn"
      data-item-action="${escapeHtml(action)}"
      data-item-source="${escapeHtml(source)}"
      data-item-index="${index}"
      ${extraAttrs}
    >${escapeHtml(label)}</button>
  `;

  const renderActionableItemCard = (item, index, source, metaText = "", actions = []) => {
    const rarity = String(item?.rarity ?? "common").toLowerCase();
    return `
    <div class="item-card item-card--${escapeHtml(rarity)}${source.startsWith("tower:") ? " item-card--inline" : ""}" style="--item-accent: ${escapeHtml(getItemAccent(item))}">
      ${renderItemChip(item, index, source, metaText)}
      ${actions.length > 0 ? `<div class="item-card__actions">${actions.join("")}</div>` : ""}
    </div>
  `;
  };

  const renderItemGroup = (title, items, source, emptyText, metaTextFn = null) => `
    <div class="item-group">
      <div class="item-group__title">${escapeHtml(title)}</div>
      ${items.length > 0
        ? `<div class="item-group__list">${items
            .map((item, index) => renderItemChip(item, index, source, metaTextFn ? metaTextFn(item, index) : ""))
            .join("")}</div>`
        : `<div class="item-group__empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `;

  const renderActionableItemGroup = (title, items, source, emptyText, metaTextFn, actionBuilder) => `
    <div class="item-group">
      <div class="item-group__title">${escapeHtml(title)}</div>
      ${items.length > 0
        ? `<div class="item-group__list">${items
            .map((item, index) => renderActionableItemCard(item, index, source, metaTextFn?.(item, index) ?? "", actionBuilder(item, index)))
            .join("")}</div>`
        : `<div class="item-group__empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `;

  const renderShopGrid = () => {
    const unlockedRows = getUnlockedShopRows();
    const rows = [];

    for (let rowIndex = 0; rowIndex < SHOP_ROW_COUNT; rowIndex += 1) {
      const rowUnlocked = rowIndex < unlockedRows;
      const unlockLevel = rowIndex === 0 ? 1 : rowIndex === 1 ? 10 : 20;
      const cells = [];
      for (let colIndex = 0; colIndex < SHOP_COL_COUNT; colIndex += 1) {
        const slotIndex = rowIndex * SHOP_COL_COUNT + colIndex;
        const item = shopInventory[slotIndex] ?? null;
        if (!rowUnlocked) {
          cells.push(`<div class="shop-slot shop-slot--locked">Ligne verrouillée<br>Niveau shop ${unlockLevel}</div>`);
          continue;
        }
        if (!item) {
          cells.push('<div class="shop-slot shop-slot--empty">Case vide</div>');
          continue;
        }
        cells.push(renderActionableItemCard(item, slotIndex, "shop", `${getItemRarityLabel(item)} • ${item.cost} or`, [renderItemActionButton("Acheter", "buy-shop", "shop", slotIndex)]));
      }

      rows.push(`
        <div class="item-group">
          <div class="item-group__title">${rowIndex === 0 ? "Objets" : rowUnlocked ? "Ligne ouverte" : `Ligne verrouillée (${unlockLevel})`}</div>
          <div class="shop-grid">${cells.join("")}</div>
        </div>
      `);
    }

    return rows.join("");
  };

  const getInventoryTooltip = () => {
    if (stash.length === 0) {
      return "Inventaire vide";
    }
    const first = stash[0];
    const dmg = first?.modifiers?.damageMul ?? 1;
    const rngBonus = first?.modifiers?.rangeFlat ?? 0;
    const aspd = first?.modifiers?.attackSpeedMul ?? 1;
    return `Objets ${stash.length} | ${first.name} | Cout 0 or | Dmg x${dmg.toFixed(2)} | Rng +${rngBonus} | DPS x${aspd.toFixed(2)}`;
  };

  const getShopTooltip = () => {
    if (!isShopUnlocked()) {
      return "Boutique verrouillée | Débloque la connaissance shop pour y accéder.";
    }
    const discount = Math.round((1 - (runBonuses.bonusShopCostMul ?? 1)) * 100);
    return `Boutique | Niveau ${getShopKnowledgeLevel()} | Lignes ouvertes ${getUnlockedShopRows()}/3 | Remise ${discount}% | Réapprovisionnement ${SHOP_RESTOCK_COST} or.`;
  };

  const getInvestedGold = (tower) => Math.max(0, Math.floor(tower?.getTotalGoldValue?.() ?? 0));
  const getSellRefund = (tower) => Math.floor(getInvestedGold(tower) * SELL_REFUND_FACTOR);

  const getTowerOtherText = (tower, level = tower?.level ?? 1) => {
    if (!tower) {
      return "Standard";
    }

    if (tower.isAuraTower) {
      return getAuraEffectData(tower.selectedAuraEffect, level, tower.getAuraRangeAtLevel?.(level, tower.selectedAuraEffect) ?? tower.range).summary;
    }

    const rawText = tower.getSpecialTextAtLevel?.(level) ?? tower.getSpecialText?.() ?? tower.specialText ?? "Standard";
    if (!tower.auraChaosEnabled) {
      return rawText;
    }

    return String(rawText)
      .replace(/piercing/gi, "chaos")
      .replace(/magic/gi, "chaos")
      .replace(/bludgeoning/gi, "chaos");
  };

  const formatTowerOtherDiff = (currentText, nextText) => {
    const currentParts = String(currentText ?? "Standard")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const nextParts = String(nextText ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (currentParts.length === 0) {
      return nextParts.join(", ") || "Standard";
    }

    const diffParts = currentParts.map((part, index) => {
      const nextPart = nextParts[index];
      if (!nextPart || nextPart === part) {
        return part;
      }
      return `${part} (${nextPart})`;
    });

    if (nextParts.length > currentParts.length) {
      diffParts.push(...nextParts.slice(currentParts.length));
    }

    return diffParts.join(", ");
  };

  const getSelectedTower = () => {
    if (!selectedPadId) {
      return null;
    }
    const pad = buildPads.find((entry) => entry.id === selectedPadId) ?? null;
    if (!pad?.towerId) {
      return null;
    }
    return towers.find((entry) => entry.id === pad.towerId) ?? null;
  };

  const splitTowerOtherSegments = (text) =>
    String(text ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const getTowerLevelTooltip = (tower) => {
    const level10Text = getTowerOtherText(tower, tower.bonusLevelThreshold);
    const beforeLevel10Text = getTowerOtherText(tower, Math.max(1, tower.bonusLevelThreshold - 1));
    const revealLine = runBonuses.revealUnlocked && canTowerReveal(tower.blueprintId)
      ? "Revele aussi les creeps invisibles dans sa portee au niveau 10."
      : null;

    return {
      title: `Niveau ${tower.level}/${tower.maxLevel}`,
      lines: [
        beforeLevel10Text !== level10Text
          ? `Niveau 10: ${formatTowerOtherDiff(beforeLevel10Text, level10Text)}`
          : `Niveau 10: ${level10Text}`,
        revealLine,
      ].filter(Boolean),
      accent: tower.color,
    };
  };

  const getTowerDpsTooltip = (tower) => {
    const currentHitsPerSecond = tower.attackCd > 0 ? 1 / tower.attackCd : 0;
    const preview = showUpgradePreview ? tower.getUpgradePreview() : null;
    const lines = [`Cadence actuelle: ${currentHitsPerSecond.toFixed(2)} hit/s`];
    if (preview?.attackCd) {
      lines.push(`Apres amelioration: ${(1 / preview.attackCd).toFixed(2)} hit/s`);
    }
    return {
      title: "DPS",
      lines,
      accent: tower.color,
    };
  };

  const getOrderTooltip = (tower) => {
    if (tower?.isAuraTower) {
      const previewLevel = tower.level <= 0 ? 1 : tower.level;
      const info = getAuraEffectData(
        tower.selectedAuraEffect,
        previewLevel,
        tower.getAuraRangeAtLevel?.(previewLevel, tower.selectedAuraEffect) ?? tower.range,
      );
      const currentSummary = tower.level <= 0
        ? `Effet sélectionné au niveau 1: ${getAuraEffectData(tower.selectedAuraEffect, previewLevel, tower.getAuraRangeAtLevel?.(previewLevel, tower.selectedAuraEffect) ?? tower.range).summary}`
        : `Effet actuel: ${info.summary}`;
      const lockLine = tower.canChangeAuraEffect?.()
        ? "Clique pour changer l'effet tant que la tour est niveau 0."
        : "L'effet est verrouille a partir du niveau 1.";
      return {
        title: `Effet: ${getAuraDisplayEffectName(tower.selectedAuraEffect)}`,
        lines: [currentSummary, ...info.lines, lockLine],
        accent: tower?.color ?? "#fef08a",
      };
    }

    const currentOrder = tower?.targetMode ?? "avance";
    const descriptions = {
      proche: "Cible en priorité le creep le plus proche de la tour.",
      eloigne: "Cible en priorité le creep le plus éloigné dans sa portée.",
      avance: "Cible en priorité le creep le plus avancé sur son chemin.",
      recule: "Cible en priorité le creep le moins avancé sur son chemin.",
      faible: "Cible en priorité le creep avec le moins de vie à sa portée.",
      fort: "Cible en priorité le creep avec le plus de vie à sa portée.",
      stop: "La tour cesse d'attaquer tant que cet ordre reste actif.",
    };

    return {
      title: `Ordre: ${currentOrder}`,
      lines: [descriptions[currentOrder] ?? "Ordre de ciblage de la tour."],
      accent: tower?.color ?? "#93c5fd",
    };
  };

  const getTowerOtherSegmentTooltip = (segment) => {
    const previewMatch = String(segment).match(/^(.*?) \((.*?)\)$/);
    const currentSegment = (previewMatch?.[1] ?? segment).trim();
    const nextSegment = (previewMatch?.[2] ?? "").trim();
    const keyword = currentSegment.split(/[ (]/)[0].toLowerCase();
    const previewLine = nextSegment ? `Apres amelioration: ${nextSegment}` : null;

    const tooltipByKeyword = {
      bounce: {
        title: currentSegment,
        lines: ["Le projectile ricoche sur des ennemis proches.", previewLine],
      },
      zone: {
        title: currentSegment,
        lines: ["Touche plusieurs cibles en meme temps dans la zone de la tour.", previewLine],
      },
      burn: {
        title: currentSegment,
        lines: ["Applique des stacks de burn qui infligent des degats sur la duree.", previewLine],
      },
      poison: {
        title: currentSegment,
        lines: ["Applique du poison et des degats sur la duree.", previewLine],
      },
      slowpoison: {
        title: currentSegment,
        lines: ["Le poison ralentit la cible pendant la duree indiquee.", previewLine],
      },
      slow: {
        title: currentSegment,
        lines: ["Ralentit la cible pendant la duree indiquee.", previewLine],
      },
      freeze: {
        title: currentSegment,
        lines: ["Fige completement la cible pendant la duree indiquee.", previewLine],
      },
      splash: {
        title: currentSegment,
        lines: ["Inflige des effets ou degats de zone autour de la cible.", previewLine],
      },
      multishot: {
        title: currentSegment,
        lines: ["Ajoute des tirs supplementaires sur l'attaque principale.", previewLine],
      },
      stun: {
        title: currentSegment,
        lines: ["Peut etourdir la cible et empecher ses actions.", previewLine],
      },
      eyes: {
        title: currentSegment,
        lines: ["La tour peut cibler les creeps invisibles.", previewLine],
      },
      ground: {
        title: currentSegment,
        lines: ["La tour ne peut viser que les cibles au sol.", previewLine],
      },
      piercing: {
        title: currentSegment,
        lines: ["Type d'attaque efficace contre light et faible contre heavy.", previewLine],
      },
      bludgeoning: {
        title: currentSegment,
        lines: ["Type d'attaque physique ecrasante.", previewLine],
      },
      magic: {
        title: currentSegment,
        lines: ["Type d'attaque magique, bloque par magic immunity.", previewLine],
      },
      chaos: {
        title: currentSegment,
        lines: ["Type d'attaque polyvalent, bon contre les cibles divines.", previewLine],
      },
    };

    const tooltip = tooltipByKeyword[keyword] ?? {
      title: currentSegment,
      lines: [previewLine].filter(Boolean),
    };

    return {
      title: tooltip.title,
      lines: tooltip.lines.filter(Boolean),
      accent: getSelectedTower()?.color ?? "#93c5fd",
    };
  };

  const getCreepTooltip = (creep) => {
    const effectLines = [];
    if (creep.isInvisible && !creep.isRevealed?.()) {
      effectLines.push("Invisible");
    }
    if (creep.isRevealed?.()) {
      effectLines.push("Revele");
    }
    if ((creep.shieldHp ?? 0) > 0) {
      effectLines.push(`Bouclier ${Math.ceil(creep.shieldHp)}/${Math.ceil(creep.shieldMaxHp ?? 0)}`);
    }
    if ((creep.burnStacks ?? 0) > 0) {
      effectLines.push(`burn(${creep.burnStacks})`);
    }
    if ((creep.poisonStacks ?? 0) > 0) {
      effectLines.push(`poison(${creep.poisonStacks})`);
    }
    if ((creep.freezeTimer ?? 0) > 0) {
      effectLines.push(`freeze(${creep.freezeTimer.toFixed(1)}s)`);
    }
    if ((creep.iceSlowTimer ?? 0) > 0) {
      effectLines.push(`slow-glace(x${Number(creep.iceSlowMul ?? 1).toFixed(2)})`);
    }
    if ((creep.poisonSlowTimer ?? 0) > 0) {
      effectLines.push(`slow-poison(x${Number(creep.poisonSlowMul ?? 1).toFixed(2)})`);
    }
    if ((creep.stunTimer ?? 0) > 0) {
      effectLines.push(`stun(${creep.stunTimer.toFixed(1)}s)`);
    }

    const baseArmor = Number(creep.baseArmor ?? creep.armor ?? 0);
    const currentArmor = Number(creep.getEffectiveArmor?.() ?? creep.armor ?? 0);
    const armorText = currentArmor !== baseArmor
      ? `${highlightAuraText(Math.round(currentArmor))} ${highlightAuraText(`(base ${Math.round(baseArmor)})`)}`
      : `${Math.round(currentArmor)}`;

    const baseSpeed = Number(creep.baseSpeed ?? creep.speed ?? 0);
    const effectiveSpeed = Number(creep.getEffectiveSpeed?.() ?? creep.speed ?? 0);
    const speedText = Math.abs(effectiveSpeed - baseSpeed) > 0.001
      ? `${highlightAuraText(effectiveSpeed.toFixed(2))} ${highlightAuraText(`(base ${baseSpeed.toFixed(2)})`)}`
      : `${effectiveSpeed.toFixed(2)}`;
    const goldDrop = Math.max(
      1,
      Math.floor((creep.maxHp ?? 0) * 0.04 * (creep.bountyMultiplier ?? 1) * (runBonuses.bonusKillGoldMul ?? 1)),
    );
    const itemDropText = creep.plannedDropItem
      ? `${creep.plannedDropItem.name} (${getItemRarityLabel(creep.plannedDropItem)})`
      : "aucun";

    const auraEffectsLine = (creep.auraEffectDetails ?? []).length > 0
      ? `Aura: ${highlightAuraText(Array.from(new Set(creep.auraEffectDetails)).join(", "))}`
      : null;

    return {
      title: `Creep ${creep.id}`,
      lines: [
        `PV: ${Math.ceil(creep.currentHp)}/${Math.ceil(creep.maxHp)}`,
        `Type: ${String(creep.waveType ?? "NORMAL").toUpperCase()}`,
        `Armure: ${armorText} | Classe: ${creep.armorType ?? "none"}`,
        `Vitesse: ${speedText}`,
        `Drop or: ${goldDrop}`,
        `Drop objet: ${itemDropText}`,
        auraEffectsLine,
        effectLines.length > 0 ? `Effets: ${effectLines.join(", ")}` : "Effets: aucun",
      ].filter(Boolean),
      accent: creep.isInvisible && !creep.isRevealed?.() ? "#cbd5e1" : "#f87171",
    };
  };

  const findHoveredCreep = (x, y) => {
    let nearest = null;
    let nearestDistSq = Number.POSITIVE_INFINITY;

    for (const creep of creeps) {
      if (!creep?.isAlive?.()) {
        continue;
      }

      const radius = creep.bossMeta ? 14 : 10;
      const hitRadius = radius + 8;
      const dx = creep.position.x - x;
      const dy = creep.position.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq > hitRadius * hitRadius) {
        continue;
      }
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = creep;
      }
    }

    return nearest;
  };

  const formatTowerLabel = (tower) => {
    const blueprint = TOWER_BLUEPRINTS[tower?.blueprintId];
    if (blueprint?.label) {
      return blueprint.label;
    }
    const label = String(tower?.blueprintId ?? "standard");
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const buildTowerStatRows = ({
    type,
    color,
    levelValue,
    damageValue,
    rangeValue,
    dpsValue,
    xpValue,
    otherText,
    otherAuraSegments = [],
  }) => ({
    color,
    rows: [
      { key: "type", icon: "&#9632;", label: "Type", value: type },
      { key: "level", icon: "&#11014;", label: "Niveau", value: levelValue },
      { key: "attack", icon: "&#9876;", label: "Attaque", value: damageValue },
      { key: "range", icon: "&#10138;", label: "Portee", value: rangeValue },
      { key: "dps", icon: "&#9889;", label: "DPS", value: dpsValue },
      { key: "xp", icon: "&#10010;", label: "EXP", value: xpValue },
      { key: "other", icon: "&#9432;", label: "Autres", value: otherText, auraSegments: otherAuraSegments, wide: true },
    ],
  });

  const renderTowerStatValueMarkup = (row, compactValueClass) => {
    if (row.key === "other") {
      const segments = splitTowerOtherSegments(row.value);
      const auraSegments = Array.isArray(row.auraSegments) ? row.auraSegments : [];
      return `<span class="tower-stat__value${compactValueClass}" data-stat-key="other">${segments
        .map(
          (segment) => `<span class="tower-stat__segment" data-other-segment="${escapeHtml(segment)}">${escapeHtml(segment)}</span>`,
        )
        .concat(auraSegments.map((segment) => `<span class="tower-stat__segment" data-other-segment="${escapeHtml(segment)}">${highlightAuraText(escapeHtml(segment))}</span>`))
        .join('<span class="tower-stat__separator">, </span>')}</span>`;
    }

    return `<span class="tower-stat__value${compactValueClass}" data-stat-key="${row.key}">${row.value}</span>`;
  };

  const renderTowerStatsMarkup = ({ color, rows }) =>
    rows
      .map(
        (row) => {
          const compactValueClass = row.label === "DPS" || String(row.value).includes("(")
            ? " tower-stat__value--compact"
            : "";
          return `
          <div class="tower-stat${row.wide ? " tower-stat--wide" : ""}">
            <span class="tower-stat__icon">${row.icon}</span>
            <span class="tower-stat__label">${row.label}</span>
            ${renderTowerStatValueMarkup(row, compactValueClass)}
          </div>
        `;
        },
      )
      .join("");

  const positionTowerHoverCard = (event) => {
    const card = ui.towerHoverCard;
    const offset = 18;
    const maxLeft = window.innerWidth - card.offsetWidth - 12;
    const maxTop = window.innerHeight - card.offsetHeight - 12;
    const left = Math.min(maxLeft, event.clientX + offset);
    const top = Math.min(maxTop, event.clientY + offset);
    card.style.left = `${Math.max(12, left)}px`;
    card.style.top = `${Math.max(12, top)}px`;
  };

  const showTowerHoverCard = (towerType, event) => {
    const bp = TOWER_BLUEPRINTS[towerType];
    if (!bp) {
      return;
    }

    const preview = buildTowerStatRows({
      type: bp.label,
      color: bp.color,
      levelValue: "1/10",
      damageValue: `${bp.damage}`,
      rangeValue: `${bp.range}`,
      dpsValue: `${(bp.damage / bp.attackCd).toFixed(1)}`,
      xpValue: `0/${bp.xpBase}`,
      otherText: bp.specialText ?? "Standard",
    });

    ui.towerHoverCard.style.setProperty("--tower-accent", preview.color);
    ui.towerHoverCard.innerHTML = renderTowerStatsMarkup(preview);
    ui.towerHoverCard.classList.remove("hidden");
    ui.towerHoverCard.setAttribute("aria-hidden", "false");
    positionTowerHoverCard(event);
  };

  const hideTowerHoverCard = () => {
    ui.towerHoverCard.classList.add("hidden");
    ui.towerHoverCard.setAttribute("aria-hidden", "true");
  };

  const renderTowerStats = (tower) => {
    if (!tower) {
      ui.towerStats.style.removeProperty("--tower-accent");
      ui.towerManageGroup.style.removeProperty("--tower-accent");
      ui.towerStats.classList.remove("tower-stats--active");
      ui.towerStats.innerHTML = "Tour: aucune selection";
      return;
    }

    const nextXp = tower.getXpForNextLevel();
    const xpCap = nextXp > 0 ? nextXp : tower.xp;
    const preview = showUpgradePreview ? tower.getUpgradePreview() : null;
    const nextLevelText = preview ? ` (${Math.min(tower.level + 1, tower.maxLevel)}/${tower.maxLevel})` : "";
    const nextDamageText = preview
      ? ` (${tower.isAuraTower ? getAuraAttackDisplay(tower, preview.level) : preview.damage})`
      : "";
    const nextRangeText = preview ? ` (${preview.range})` : "";
    const nextDpsText = preview ? ` (${preview.dps.toFixed(1)})` : "";
    const currentOtherText = getTowerOtherText(tower);
    const nextOtherText = preview ? getTowerOtherText(tower, preview.level) : "";
    const otherText = preview && nextOtherText !== currentOtherText
      ? formatTowerOtherDiff(currentOtherText, nextOtherText)
      : currentOtherText;
    const auraDetails = tower.isAuraTower ? (tower.auraEffectDetails ?? []) : [];
    const damageAuraNote = "";
    const rangeAuraNote = "";
    const currentDps = tower.getDps();
    const dpsBeforeAura = tower.getDpsBeforeAura?.() ?? currentDps;
    const dpsAuraNote = "";
    const knowledgeDamageNote = runBonuses.bonusTowerDamageMul > 1
      ? `know +${Math.round((runBonuses.bonusTowerDamageMul - 1) * 100)}%`
      : "";
    const knowledgeRangeNote = runBonuses.bonusTowerRangeMul > 1
      ? `know +${Math.round((runBonuses.bonusTowerRangeMul - 1) * 100)}%`
      : "";
    const knowledgeAttackSpeedNote = runBonuses.bonusTowerAttackSpeedMul > 1
      ? `know +${Math.round((runBonuses.bonusTowerAttackSpeedMul - 1) * 100)}% as`
      : "";
    const combinedDamageNote = [knowledgeDamageNote, damageAuraNote].filter(Boolean).join(", ");
    const combinedRangeNote = [knowledgeRangeNote, rangeAuraNote].filter(Boolean).join(", ");
    const combinedDpsNote = [knowledgeAttackSpeedNote, dpsAuraNote].filter(Boolean).join(", ");
    const statRows = buildTowerStatRows({
      type: formatTowerLabel(tower),
      color: tower.color,
      levelValue: `${tower.level}/${Math.max(10, tower.maxLevel)}${nextLevelText}`,
      damageValue: `${tower.isAuraTower ? 0 : formatAuraTowerStatValue(tower.damage, combinedDamageNote)}${nextDamageText}`,
      rangeValue: `${tower.isAuraTower ? tower.range : formatAuraTowerStatValue(tower.range, combinedRangeNote)}${nextRangeText}`,
      dpsValue: `${tower.isAuraTower ? tower.getDps().toFixed(1) : formatAuraTowerStatValue(tower.getDps().toFixed(1), combinedDpsNote)}${nextDpsText}`,
      xpValue: `${tower.xp}/${xpCap}`,
      otherText,
      otherAuraSegments: auraDetails,
    });
    const canShowAddItem = tower.canAddItem() && stash.length > 0;
    const towerItemsMarkup = `
      <div class="item-group">
        <div class="item-group__header">
          <div class="item-group__title">Inventaire (${tower.items.length}/${tower.itemSlots})</div>
          ${canShowAddItem ? '<button type="button" class="item-group__icon-btn" data-tower-action="open-stash" title="Ajouter un objet" aria-label="Ajouter un objet">+</button>' : ""}
        </div>
        ${tower.items.length > 0
          ? `<div class="item-group__list">${tower.items
              .map((item, index) => {
                const rarityAccent = getItemAccent(item);
                return renderActionableItemCard(item, index, `tower:${tower.id}`, `Tour ${tower.id}`, [
                  renderItemActionButton(
                    "X",
                    "remove-tower-item",
                    `tower:${tower.id}`,
                    index,
                    `title="Retirer l\'objet" aria-label="Retirer l\'objet" style="--item-accent: ${escapeHtml(rarityAccent)}; background: color-mix(in srgb, ${escapeHtml(rarityAccent)} 22%, rgba(15, 23, 33, 0.82)); border-color: color-mix(in srgb, ${escapeHtml(rarityAccent)} 60%, rgba(142, 164, 191, 0.22)); color: #f3f7fc;"`,
                  ),
                ]);
              })
              .join("")}</div>`
          : '<div class="item-group__empty">Aucun objet équipé</div>'}
      </div>
    `;

    ui.towerStats.style.setProperty("--tower-accent", tower.color);
    ui.towerManageGroup.style.setProperty("--tower-accent", tower.color);
    ui.towerStats.classList.add("tower-stats--active");
    ui.towerStats.innerHTML = `${renderTowerStatsMarkup(statRows)}${towerItemsMarkup}`;
  };

  const getEquippedItems = () =>
    towers.flatMap((tower) =>
      tower.items.map((item, index) => ({
        item,
        source: `tower:${tower.id}`,
        towerId: tower.id,
        towerLabel: formatTowerLabel(tower),
        itemIndex: index,
        meta: `Tour ${tower.id} • slot ${index + 1}`,
      })),
    );

  const renderInventoryPanel = () => {
    const previousCard = ui.inventoryPanel.querySelector(".inventory-panel__card");
    const previousScrollTop = previousCard?.scrollTop ?? 0;
    const equippedItems = getEquippedItems();
    const selectedTower = pendingTowerItemTargetId ? getTowerById(pendingTowerItemTargetId) : null;
    const inventoryHeader = inventoryPanelMode === "shop"
      ? `Boutique | Niveau ${getShopKnowledgeLevel()} | Or: ${gold}`
      : pendingTowerSelectionItemId
        ? "Choisissez une tour pour l'objet sélectionné. Clic droit pour annuler."
        : selectedTower
          ? `Choisissez un objet pour ${selectedTower.id}. Clic droit ou clic ailleurs pour annuler.`
          : `Objets joueur: ${stash.length} | équipés: ${equippedItems.length}`;

    const stashMarkup = renderActionableItemGroup(
      "Inventaire joueur",
      stash,
      "stash",
      "Aucun objet dans le stash",
      (item) => `${getItemRarityLabel(item)} • Vente ${getItemSellValue(item)} or`,
      (item, index) => {
        if (pendingTowerSelectionItemId) {
          if (pendingTowerSelectionItemId === item.id) {
            return [renderItemActionButton("Annuler", "cancel-pick-tower", "stash", index)];
          }
          return [renderItemActionButton("Vendre", "sell-stash", "stash", index)];
        }
        const actions = [renderItemActionButton("Vendre", "sell-stash", "stash", index)];
        if (pendingTowerItemTargetId) {
          actions.push(renderItemActionButton("Equiper", "equip-target-tower", "stash", index));
        } else {
          actions.push(renderItemActionButton("Distribuer", "pick-tower-for-item", "stash", index));
        }
        return actions;
      },
    );

    const equippedMarkup = renderActionableItemGroup(
      "Objets équipés",
      equippedItems.map((entry) => entry.item),
      "equipped",
      "Aucun objet équipé",
      (item, index) => equippedItems[index]?.meta ?? "",
      (_, index) => [renderItemActionButton("Retirer", "remove-equipped", "equipped", index)],
    );

    const shopMarkup = `
      <div class="item-group">
        <div class="item-group__title">Marchandises</div>
        ${renderShopGrid()}
      </div>
    `;

    ui.inventoryPanel.innerHTML = `
      <div class="inventory-panel__card">
        <div class="inventory-panel__header">
          <div>
            <div class="inventory-panel__title">${inventoryPanelMode === "shop" ? "Boutique" : "Inventaire"}</div>
            <div class="inventory-panel__points">${inventoryHeader}</div>
          </div>
          <div class="inventory-panel__header-actions">
            ${inventoryPanelMode === "inventory"
              ? `
                <button id="inventorySortBtn" type="button" title="Changer le mode de tri" aria-label="Changer le mode de tri">Trier: ${getStashSortLabel()}</button>
                <button id="inventoryAutoAssignBtn" type="button" title="Assigner automatiquement les objets du stash aux tours avec de la place" aria-label="Assigner automatiquement les objets du stash aux tours avec de la place">Auto assigne</button>
                <button id="inventorySellAllBtn" type="button" title="Tout vendre dans l'inventaire du joueur" aria-label="Tout vendre dans l'inventaire du joueur">Tout vendre</button>
              `
              : ""}
            ${inventoryPanelMode === "shop" && isShopUnlocked()
              ? `<button id="shopRestockBtn" type="button" title="Réapprovisioner/Regénérer les produits" aria-label="Réapprovisioner/Regénérer les produits" ${gold < SHOP_RESTOCK_COST ? "disabled" : ""}>⟳ 1000</button>`
              : ""}
            <button id="inventoryCloseBtn" type="button">Fermer</button>
          </div>
        </div>
        ${inventoryPanelMode === "shop" ? shopMarkup : `${stashMarkup}${equippedMarkup}`}
      </div>
    `;

    const closeButton = ui.inventoryPanel.querySelector("#inventoryCloseBtn");
    closeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleInventoryPanel(false);
    });

    const sortButton = ui.inventoryPanel.querySelector("#inventorySortBtn");
    sortButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleStashSortMode();
    });

    const autoAssignButton = ui.inventoryPanel.querySelector("#inventoryAutoAssignBtn");
    autoAssignButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      autoAssignStashItems();
    });

    const sellAllButton = ui.inventoryPanel.querySelector("#inventorySellAllBtn");
    sellAllButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sellAllStashItems();
    });

    const restockButton = ui.inventoryPanel.querySelector("#shopRestockBtn");
    restockButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      restockShopInventory();
    });

    const nextCard = ui.inventoryPanel.querySelector(".inventory-panel__card");
    if (nextCard) {
      nextCard.scrollTop = previousScrollTop;
    }
  };

  const syncOpenShopPanelState = () => {
    if (!inventoryPanelOpen || inventoryPanelMode !== "shop") {
      return;
    }

    const points = ui.inventoryPanel.querySelector(".inventory-panel__points");
    if (points) {
      points.textContent = `Boutique | Niveau ${getShopKnowledgeLevel()} | Or: ${gold}`;
    }

    const restockButton = ui.inventoryPanel.querySelector("#shopRestockBtn");
    if (restockButton) {
      restockButton.disabled = gold < SHOP_RESTOCK_COST;
    }
  };

  const refreshInventoryPanelIfOpen = () => {
    if (inventoryPanelOpen) {
      renderInventoryPanel();
    }
  };

  const toggleInventoryPanel = (open = !inventoryPanelOpen, mode = inventoryPanelMode, preserveManualFlow = false) => {
    inventoryPanelOpen = !!open;
    if (inventoryPanelOpen) {
      inventoryPanelMode = mode;
      if (inventoryPanelMode === "shop") {
        ensureShopInventoryForUnlockedRows();
      }
    }
    ui.inventoryPanel.classList.toggle("hidden", !inventoryPanelOpen);
    if (inventoryPanelOpen) {
      renderInventoryPanel();
    } else {
      inventoryPanelMode = "inventory";
      if (!preserveManualFlow) {
        resetManualItemFlow();
      }
      hideInfoHoverCard();
    }
  };

  const setTopMainLine = () => {
    const mission = currentMission();
    const currentProgress = waveProgress.get(currentWaveLevel) ?? null;
    const units = currentProgress
      ? Math.max(0, currentProgress.total - currentProgress.killed - (currentProgress.leaked ?? 0))
      : 0;
    const totalActiveUnits = Array.from(waveProgress.values()).reduce(
      (sum, progress) =>
        sum + Math.max(0, (progress?.total ?? 0) - (progress?.killed ?? 0) - (progress?.leaked ?? 0)),
      0,
    );
    const activeWaves = waveSpawner.getActiveWaveCount();
    const diffRaw = String(activeDifficulty ?? mission.difficulty ?? "medium").toLowerCase();
    const diffLabel = diffRaw === "extreme" ? "extreme" : getDifficultyLabel(diffRaw);
    ui.topMain.innerHTML = `
      <span class="top-main__item top-main__item--left">🌊 Vague #${currentWaveLevel} | ${selectedGameMode.toUpperCase()}</span>
      <span class="top-main__item">👾 Unites ${units} (${totalActiveUnits})</span>
      <span class="top-main__item">🌀 Vagues actives ${activeWaves}</span>
      <span class="top-main__item top-main__item--center">🎚 Difficulte ${diffLabel.toUpperCase()}</span>
      <span class="top-main__item">🪙 Or ${gold}</span>
      <span class="top-main__item">❤ Vie ${portalLives}</span>
      <span class="top-main__item top-main__item--right">⭐ Score ${score} | ${activeProfileName || "profil"}</span>
    `;
  };

  const getPreparationSeconds = () => Math.max(0, Math.ceil(preWaveRemainingMs / 1000));
  const getPreparationClock = () => {
    const totalSeconds = getPreparationSeconds();
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const getWaveTypeLabel = (mainType) => {
    if (mainType === "MASS") {
      return "MASS";
    }
    if (mainType === "AIR") {
      return "AIR";
    }
    if (mainType === "BOSS") {
      return "BOSS";
    }
    return "NORMAL";
  };

  const getArmorTypeLabel = (armorType) => {
    const type = String(armorType ?? "-").toLowerCase();
    if (type === "light") {
      return "light";
    }
    if (type === "heavy") {
      return "heavy";
    }
    if (type === "immune") {
      return "immune";
    }
    if (type === "divin") {
      return "divin";
    }
    if (type === "life") {
      return "life";
    }
    return "neutre";
  };

  const renderWaveInfoTerm = (term, label, value = label) =>
    `<span class="wave-info-panel__term" data-wave-term="${escapeHtml(term)}" data-wave-value="${escapeHtml(value)}">${escapeHtml(label)}</span>`;

  const getWavePreviewDepth = (difficulty) => {
    const normalized = String(difficulty ?? "medium").toLowerCase();
    if (normalized === "easy") {
      return 15;
    }
    if (normalized === "hard") {
      return 5;
    }
    if (normalized === "extreme") {
      return 1;
    }
    return 10;
  };

  const getIncompleteWaveLevels = () =>
    Array.from(waveProgress.entries())
      .filter(
        ([, progress]) => Math.max(0, (progress?.total ?? 0) - (progress?.killed ?? 0) - (progress?.leaked ?? 0)) > 0,
      )
      .map(([level]) => level)
      .sort((left, right) => left - right);

  const getWaveTermTooltip = (term, value) => {
    const normalizedValue = String(value ?? "").toLowerCase();

    if (term === "type") {
      if (normalizedValue === "air") {
        return {
          title: "Type AIR",
          lines: ["Unites aeriennes.", "Les tours ground-only ne peuvent pas les cibler."],
          accent: "#93c5fd",
        };
      }
      if (normalizedValue === "mass") {
        return {
          title: "Type MASS",
          lines: ["Vague nombreuse.", "Plus d'unites a gerer en meme temps, generalement plus lentes."],
          accent: "#93c5fd",
        };
      }
      if (normalizedValue === "boss") {
        return {
          title: "Type BOSS",
          lines: ["Vague de boss.", "Peut declencher des phases et des capacites speciales."],
          accent: "#fb7185",
        };
      }
      return {
        title: "Type NORMAL",
        lines: ["Vague standard.", "Aucune propriete structurelle supplementaire."],
        accent: "#93c5fd",
      };
    }

    if (term === "armor") {
      return {
        title: "Armure",
        lines: [
          "Reduit les degats recus par les creeps.",
          "Plus l'armure est haute, plus les attaques physiques et magiques perdent en efficacite.",
        ],
        accent: "#facc15",
      };
    }

    if (term === "armorType") {
      if (normalizedValue === "light") {
        return {
          title: "Armure light",
          lines: ["Subit +20% de degats piercing.", "Le creep gagne aussi un bonus de vitesse."],
          accent: "#facc15",
        };
      }
      if (normalizedValue === "heavy") {
        return {
          title: "Armure heavy",
          lines: ["Subit beaucoup moins de degats piercing.", "Tres solide contre les attaques perçantes."],
          accent: "#facc15",
        };
      }
      if (normalizedValue === "immune") {
        return {
          title: "Armure immune",
          lines: ["Les tours magiques ne peuvent pas cibler ce creep."],
          accent: "#facc15",
        };
      }
      if (normalizedValue === "divin") {
        return {
          title: "Armure divin",
          lines: ["Reduit fortement piercing, bludgeoning et magic.", "Chaos reste le meilleur choix contre ce type."],
          accent: "#facc15",
        };
      }
      if (normalizedValue === "life") {
        return {
          title: "Armure life",
          lines: ["Ignore burn et poison.", "Tres resistant aux degats sur la duree."],
          accent: "#facc15",
        };
      }
      return {
        title: "Armure neutre",
        lines: ["Aucun modificateur special de type d'armure."],
        accent: "#facc15",
      };
    }

    if (term === "champ") {
      const count = Number(value ?? 0);
      return {
        title: "Champions",
        lines: [
          `${count} champion${count > 1 ? "s" : ""} au debut de la vague.`,
          "Chaque champion gagne environ x2.2 PV et +4 armure.",
        ],
        accent: "#c084fc",
      };
    }

    return {
      title: "Info vague",
      lines: ["Information supplementaire sur cette vague."],
      accent: "#93c5fd",
    };
  };

  const normalizeSpecialName = (special) =>
    String(special?.name_english ?? special?.label ?? special?.id ?? "")
      .trim()
      .toLowerCase();

  const getSpecialDisplayName = (special) =>
    String(special?.label ?? special?.name_english ?? special?.id ?? "special");

  const describeSpecial = (special) => {
    const name = normalizeSpecialName(special);
    if (name === "speed") {
      return "+30% vitesse";
    }
    if (name === "greater speed") {
      return "+60% vitesse";
    }
    if (name === "xtreme speed") {
      return "+100% vitesse";
    }
    if (name === "slow") {
      return "-30% vitesse";
    }
    if (name === "strong") {
      return "plus resistant";
    }
    if (name === "rich") {
      return "prime d'or augmentee";
    }
    if (name === "armored") {
      return "+4 armure";
    }
    if (name === "heavy armored") {
      return "+9 armure";
    }
    if (name === "xtreme armor") {
      return "+16 armure";
    }
    if (name === "spell resistance") {
      return "degats magiques reduits";
    }
    if (name === "magic immunity") {
      return "immunise aux attaques magiques";
    }
    if (name === "slow aura") {
      return "aura r=40: cadence tours x0.5";
    }
    if (name === "regeneration") {
      return "regen 1% PV/s";
    }
    if (name === "xtreme regeneration") {
      return "regen 3% PV/s";
    }
    if (name === "second chance") {
      return "revit 1x a 80% PV";
    }
    if (name === "evolving") {
      return "revit + gain de pouvoir aleatoire";
    }
    if (name === "protector") {
      return "bouclier, recharge env. 13s";
    }
    if (name === "meaty") {
      return "+25% PV";
    }
    if (name === "invisible") {
      return "invisible (hors tours avec eyes)";
    }
    return "effet special";
  };

  const formatSpecialsForWave = (wave) => {
    if (!Array.isArray(wave?.specials) || wave.specials.length === 0) {
      return "aucun";
    }

    return wave.specials
      .map((special) => `${getSpecialDisplayName(special)}: ${describeSpecial(special)}`)
      .join(" | ");
  };

  const formatWavePreviewLine = (wave) => {
    const typeLabel = getWaveTypeLabel(wave.mainType);
    const armorLabel = getArmorTypeLabel(wave.armorType);
    const headerHtml = `V${wave.id} | ${renderWaveInfoTerm("type", `type:${typeLabel}`, typeLabel)} | units:${wave.unitCount} | hp:${wave.health} | ${renderWaveInfoTerm("armor", `armor:${wave.armor}`, String(wave.armor))} (${renderWaveInfoTerm("armorType", armorLabel, armorLabel)}) | ${renderWaveInfoTerm("champ", `champs:${wave.championCount}`, String(wave.championCount))}`;
    const specials = `Effets: ${formatSpecialsForWave(wave)}`;
    return {
      headerHtml,
      specials,
    };
  };

  const buildWavePreviewRows = () => {
    const previewDepth = getWavePreviewDepth(activeDifficulty);
    const currentLevel = Math.max(0, currentWaveLevel || 0);
    const maxGeneratedLevel =
      generatedWaves.size > 0 ? Math.max(...Array.from(generatedWaves.keys())) : 0;

    const previewRng = new SeededRandom(1);
    previewRng.state = waveGenerator.rng.state;
    const previewGenerator = new WaveGenerator({
      rng: previewRng,
      difficulty: activeDifficulty,
      specialPool,
    });

    const predictedWaves = new Map();
    const rows = [];
    const futureStartLevel = Math.max(1, currentLevel + 1);
    const endFutureLevel = futureStartLevel + Math.max(0, previewDepth - 1);
    for (let level = Math.max(1, maxGeneratedLevel + 1); level <= endFutureLevel; level += 1) {
      predictedWaves.set(level, previewGenerator.generate(level));
    }

    const activePastLevels = getIncompleteWaveLevels().filter((level) => level < currentLevel);
    for (const level of activePastLevels) {
      const wave = generatedWaves.get(level) ?? predictedWaves.get(level);
      if (!wave) {
        continue;
      }

      const formatted = formatWavePreviewLine(wave);
      rows.push({
        level,
        current: false,
        active: true,
        headerHtml: formatted.headerHtml,
        specials: formatted.specials,
      });
    }

    if (currentLevel > 0) {
      const currentWave = generatedWaves.get(currentLevel) ?? predictedWaves.get(currentLevel);
      if (currentWave) {
        const formatted = formatWavePreviewLine(currentWave);
        rows.push({
          level: currentLevel,
          current: true,
          active: false,
          headerHtml: formatted.headerHtml,
          specials: formatted.specials,
        });
      }
    }

    for (let level = futureStartLevel; level <= endFutureLevel; level += 1) {
      const wave = generatedWaves.get(level) ?? predictedWaves.get(level);
      if (!wave) {
        continue;
      }

      const formatted = formatWavePreviewLine(wave);
      rows.push({
        level,
        current: false,
        active: false,
        headerHtml: formatted.headerHtml,
        specials: formatted.specials,
      });
    }

    return rows;
  };

  const renderWaveInfoPanel = () => {
    const rows = buildWavePreviewRows();
    const lines = rows
      .map((row) => `
        <div class="wave-info-panel__line${row.current ? " wave-info-panel__line--current" : ""}${row.active ? " wave-info-panel__line--active" : ""}">
          <div>${row.headerHtml}</div>
          <div class="wave-info-panel__effects">${escapeHtml(row.specials)}</div>
        </div>
      `)
      .join("");

    ui.waveInfoPanel.innerHTML = `
      <div class="wave-info-panel__title">Infos vague</div>
      ${lines}
    `;
  };

  const setWaveInfoOpen = (open) => {
    waveInfoOpen = open;
    ui.waveInfoPanel.classList.toggle("hidden", !waveInfoOpen);
    ui.waveInfoBtn.textContent = waveInfoOpen ? "Fermer info vague" : "Info vague";
    if (waveInfoOpen) {
      renderWaveInfoPanel();
    }
  };

  const speedValues = [1, 2, 4, 10, 0.25, 0.5];

  const getOrderModesForTower = (tower) => tower?.isAuraTower
    ? AURA_EFFECT_SEQUENCE
    : ["proche", "eloigne", "avance", "recule", "faible", "fort", "stop"];

  const getOrderLabel = (tower) => {
    if (tower?.isAuraTower) {
      return getAuraDisplayEffectName(tower.selectedAuraEffect);
    }
    const orderText = tower?.targetMode ?? "proche";
    if (orderText === "stop") {
      return "STOP";
    }
    return orderText;
  };

  const refreshRuntimeUi = () => {
    const bossText = activeWaveModifiers?.isBossWave ? ` | Boss phase ${currentBossPhase}` : "";
    ui.controlInfo.textContent = `${gamePaused ? "Etat: Pause" : `Run x${speedLevel}`} | Auto:${autoWave ? "ON" : "OFF"} | Kills:${totalKills} | Tours:${towers.length} | Lvl:${meta.playerLevel} | Scorex${runBonuses.bonusScoreMul.toFixed(2)}${bossText} | ${buildMessage}`;
    ui.padInfo.textContent = "";

    if (!selectedPadId) {
      renderTowerStats(null);
    } else {
      const pad = buildPads.find((p) => p.id === selectedPadId) ?? null;
      if (!pad) {
        renderTowerStats(null);
      } else if (!pad.towerId) {
        renderTowerStats(null);
      } else {
        const tower = towers.find((t) => t.id === pad.towerId) ?? null;
        if (!tower) {
          renderTowerStats(null);
        } else {
          const nextXp = tower.getXpForNextLevel();
          const xpText = nextXp > 0 ? `${tower.xp}/${nextXp}` : "MAX";
          const upCost = tower.getUpgradeCost();
          const upText = upCost > 0 ? `${upCost}g` : "MAX";
          const currentDps = tower.getDps();
          const preview = tower.getUpgradePreview();
          const dpsText = preview
            ? `${currentDps.toFixed(1)} -> ${preview.dps.toFixed(1)}`
            : `${currentDps.toFixed(1)} -> MAX`;
          const invested = getInvestedGold(tower);
          const sellPreview = getSellRefund(tower);
          renderTowerStats(tower);
        }
      }
    }

    syncMetaSnapshot();

    if (waveInfoOpen) {
      renderWaveInfoPanel();
    }

    syncOpenShopPanelState();

    applyControlsUi();
  };

  const applyControlsUi = () => {
    ui.pauseBtn.textContent = gamePaused ? "Resume (Space)" : "Pause (Space)";
    ui.speedBtn.textContent = `Vitesse x${speedLevel}`;
    ui.waveBtn.textContent = preWaveActive
      ? `Lancer vague 1 (${getPreparationClock()})`
      : `Lancer vague (+${getEarlyLaunchBonusPreview()} or)`;
    ui.waveBtn.disabled = false;
    ui.autoBtn.textContent = autoWave ? "Auto ON" : "Auto OFF";
    ui.preWaveCountdown.textContent = preWaveActive
      ? `Preparation vague 1: ${getPreparationClock()}`
      : "Preparation terminee";
    ui.wisdomBtn.textContent = `Sagesse: ${meta.sagessePoints}`;
    ui.craftBtn.textContent = `Boutique`;
    ui.craftBtn.disabled = !isShopUnlocked();
    ui.inventoryBtn.textContent = `Inventaire [${stash.length}]`;
    const mapLockCost = getMapLockCost(selectedDifficulty);
    ui.lockMapBtn.textContent = `${mapLocked ? "Map verrouillée" : "Verrouiller map"} (${mapLockCost})`;
    ui.lockMapBtn.removeAttribute("title");
    ui.lockMapBtn.setAttribute(
      "aria-label",
      `Verrouiller map. Le verrouillage de cette map coûtera automatiquement ${mapLockCost} points de sagesse lors de chaque nouveau run.`,
    );
    ui.lockMapBtn.classList.toggle("active", mapLocked);
    ui.runOverlay.dataset.state = gameEnded ? (victory ? "victory" : "defeat") : "running";
    ui.resetBtn.textContent = "Reset run (R)";
    ui.waveInfoBtn.textContent = waveInfoOpen ? "Fermer info vague" : "Info vague";

    const xp = metaSystem.getPlayerXpProgress();
    ui.playerProgressLabel.textContent = `Niv ${xp.currentLevel}`;
    ui.playerProgressFill.style.width = `${Math.round(xp.ratio * 100)}%`;
    maybeRefreshKnowledgePanel();

    const selectedPad = selectedPadId ? buildPads.find((p) => p.id === selectedPadId) ?? null : null;
    const selectedTower = selectedPad?.towerId
      ? towers.find((t) => t.id === selectedPad.towerId) ?? null
      : null;
    ui.orderBtn.textContent = selectedTower?.isAuraTower
      ? `Effet: ${getOrderLabel(selectedTower)}`
      : `Ordre: ${getOrderLabel(selectedTower)}`;

    const sentinelCost = getTowerPurchaseCost("sentinel");
    const pyroCost = getTowerPurchaseCost("pyro");
    const arcCost = getTowerPurchaseCost("arc");
    const frozenCost = getTowerPurchaseCost("frozen");
    const ronceCost = getTowerPurchaseCost("ronce");
    const canonCost = getTowerPurchaseCost("cannon");
    const ricochetCost = getTowerPurchaseCost("ricochet");
    const machinegunCost = getTowerPurchaseCost("machinegun");
    const scorpioCost = getTowerPurchaseCost("scorpio");

    const towerButtons = [
      { button: ui.towerSentinelBtn, towerId: "sentinel", cost: sentinelCost },
      { button: ui.towerPyroBtn, towerId: "pyro", cost: pyroCost },
      { button: ui.towerArcBtn, towerId: "arc", cost: arcCost },
      { button: ui.towerFrozenBtn, towerId: "frozen", cost: frozenCost },
      { button: ui.towerRonceBtn, towerId: "ronce", cost: ronceCost },
      { button: ui.towerCanonBtn, towerId: "cannon", cost: canonCost },
      { button: ui.towerRicochetBtn, towerId: "ricochet", cost: ricochetCost },
      { button: ui.towerMachinegunBtn, towerId: "machinegun", cost: machinegunCost },
      { button: ui.towerScorpioBtn, towerId: "scorpio", cost: scorpioCost },
      { button: ui.towerAuraBtn, towerId: "aura", cost: getTowerPurchaseCost("aura") },
    ];

    for (const { button, towerId, cost } of towerButtons) {
      const towerUnlocked = isTowerUnlockedByKnowledge(towerId);
      if (!towerUnlocked) {
        button.style.display = "none";
        button.classList.remove("active", "unavailable");
        button.setAttribute("aria-disabled", "true");
        if (selectedTowerType === towerId) {
          selectedTowerType = null;
        }
        continue;
      }

      button.style.removeProperty("display");
      const isActive = selectedTowerType === towerId;
      const affordable = gold >= cost;
      const towerColor = TOWER_BLUEPRINTS[towerId]?.color ?? "#4ec9b0";
      const label = TOWER_BLUEPRINTS[towerId]?.label ?? towerId;
      button.textContent = `${label} (${cost} or)`;
      button.classList.toggle("active", isActive);
      button.classList.toggle("unavailable", !affordable);
      button.setAttribute("aria-disabled", affordable ? "false" : "true");

      if (!affordable) {
        button.style.removeProperty("background");
        button.style.removeProperty("border-color");
        button.style.removeProperty("box-shadow");
        continue;
      }

      button.style.background = isActive
        ? colorWithAlpha(towerColor, 0.38)
        : colorWithAlpha(towerColor, 0.2);
      button.style.borderColor = isActive
        ? colorWithAlpha(towerColor, 0.96)
        : colorWithAlpha(towerColor, 0.66);
      button.style.boxShadow = isActive
        ? `0 0 0 1px ${colorWithAlpha(towerColor, 0.9)} inset`
        : "none";
    }

    const upgradeCost = selectedTower ? getTowerUpgradeCostWithAura(selectedTower) : 0;
    const upgradeAvailable = !!selectedTower && upgradeCost > 0;
    const canAffordUpgrade = upgradeAvailable && gold >= upgradeCost;
    ui.upgradeBtn.textContent = upgradeAvailable ? `Ameliorer (U) (${upgradeCost} or)` : "Ameliorer (U) (MAX)";
    ui.upgradeBtn.disabled = !canAffordUpgrade;

    const canAddItemToTower = !!selectedTower && selectedTower.canAddItem() && stash.length > 0;
    ui.towerAddItemBtn.textContent = selectedTower
      ? `Ajouter objet (${selectedTower.items.length}/${selectedTower.itemSlots})`
      : "Ajouter objet";
    ui.towerAddItemBtn.disabled = !canAddItemToTower;

    const sellRefund = selectedTower ? getSellRefund(selectedTower) : 0;
    ui.sellBtn.textContent = `Vendre (+${sellRefund} or)`;

    syncSidePanelMode();
    setTopMainLine();
  };

  const startWave = (waveLevel) => {
    const wave = waveGenerator.generate(waveLevel);
    generatedWaves.set(waveLevel, wave);
    waveProgress.set(waveLevel, {
      total: wave.unitCount,
      killed: waveProgress.get(waveLevel)?.killed ?? 0,
      leaked: waveProgress.get(waveLevel)?.leaked ?? 0,
    });
    activeWaveModifiers = waveModifierSystem.build(wave, missions[selectedMissionId]);
    currentBossPhase = 1;
    creepsKilledInWave = 0;
    creepsLeakedInWave = 0;
    waveSpawnFinished = false;
    waveSpawner.start(wave);
    const modText = activeWaveModifiers
      ? `mods hp x${activeWaveModifiers.hpMul.toFixed(2)} spd x${activeWaveModifiers.speedMul.toFixed(2)} armor +${activeWaveModifiers.armorFlat}`
      : "mods -";
    buildMessage = `Vague ${waveLevel} ${wave.mainType} - ${modText}`;
    setTopMainLine();
  };

  const clearRunEntities = () => {
    creeps.length = 0;
    towers.length = 0;
    for (const pad of buildPads) {
      pad.towerId = null;
    }
  };

  const regenerateMapLayout = () => {
    pathMap = new PathMap(generatePathConfigForMode(rng, selectedDifficulty, selectedGameMode));
    spawnPoints = pathMap.getSpawnPoints();
    buildPads = createBuildPadsFromGrid(pathMap);
  };

  const resetRun = () => {
    clearRunEntities();
    waveSpawner.clear();
    let keptCurrentMap = false;
    let resetMessageSuffix = "";
    if (mapLocked) {
      const lockCost = getMapLockCost(selectedDifficulty);
      if (metaSystem.spendSagesse(lockCost)) {
        syncMetaSnapshot();
        keptCurrentMap = true;
        resetMessageSuffix = ` | Map verrouillée (-${lockCost} sagesse)`;
      } else {
        syncMetaSnapshot();
        resetMessageSuffix = ` | Sagesse insuffisante pour verrouiller la map (${lockCost})`;
      }
    }
    if (!keptCurrentMap) {
      regenerateMapLayout();
    }
    resetManualItemFlow();
    inventoryPanelOpen = false;
    inventoryPanelMode = "inventory";
    ui.inventoryPanel.classList.add("hidden");

    const mission = missions[selectedMissionId];
    runBonuses = metaSystem.getRunBonuses(selectedDifficulty);
    activeDifficulty = selectedDifficulty;
    waveGenerator.difficulty = activeDifficulty;

    currentWaveLevel = 0;
    creepsKilledInWave = 0;
    creepsLeakedInWave = 0;
    totalKills = 0;
    score = 0;
    gold = getStartingGoldByDifficulty(activeDifficulty) + runBonuses.bonusStartingGold;
    portalLives = getStartingLivesByDifficulty(activeDifficulty) + runBonuses.bonusPortalLives;
    stash = [];
    targetWave = TARGET_WAVE_VICTORY;
    waveSpawnFinished = false;
    combatLastHit = "";
    waveProgress.clear();
    generatedWaves.clear();
    completedWaveLevels.clear();
    preWaveRemainingMs = PRE_WAVE_DURATION_MS;
    preWaveActive = true;
    buildMessage = `Run reset (${selectedGameMode}). Build: clic gauche sur pad vide | Sell: clic droit sur pad occupe${resetMessageSuffix}`;
    selectedPadId = null;
    selectedTowerType = null;
    gameEnded = false;
    victory = false;
    runResolved = false;
    endlessMode = false;
    awaitingVictoryChoice = false;
    hideRunOverlay();
    syncSidePanelMode();
    sessionElapsedSeconds = 0;
    sessionLastTimestamp = performance.now();
    applyControlsUi();
    saveActiveProfileSnapshot();
  };

  const canvasToWorld = (event) => {
    const rect = ui.canvas.getBoundingClientRect();
    const sx = ui.canvas.width / rect.width;
    const sy = ui.canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * sx,
      y: (event.clientY - rect.top) * sy,
    };
  };

  const findPadAt = (x, y) => {
    const radiusSq = BUILD_PAD_RADIUS * BUILD_PAD_RADIUS;
    return (
      buildPads.find((pad) => {
        const dx = pad.x - x;
        const dy = pad.y - y;
        return dx * dx + dy * dy <= radiusSq;
      }) ?? null
    );
  };

  const findTowerAt = (x, y) => {
    for (let index = towers.length - 1; index >= 0; index -= 1) {
      const tower = towers[index];
      if (tower.isAuraTower) {
        const width = GRID_SIZE * Math.max(1, tower.footprintWidth) - 8;
        const height = GRID_SIZE * Math.max(1, tower.footprintHeight) - 8;
        const left = tower.position.x - width / 2;
        const top = tower.position.y - height / 2;
        if (x >= left && x <= left + width && y >= top && y <= top + height) {
          return tower;
        }
        continue;
      }

      const radius = tower.level >= tower.maxLevel ? 19 : 16;
      const dx = tower.position.x - x;
      const dy = tower.position.y - y;
      if (dx * dx + dy * dy <= radius * radius) {
        return tower;
      }
    }
    return null;
  };

  const getPadByGrid = (col, row) => buildPads.find((pad) => pad.col === col && pad.row === row) ?? null;

  const getAuraPlacementPads = (anchorPad, requireFree = true) => {
    if (!anchorPad) {
      return null;
    }

    const candidates = [
      { col: anchorPad.col, row: anchorPad.row },
      { col: anchorPad.col - 1, row: anchorPad.row },
      { col: anchorPad.col, row: anchorPad.row - 1 },
      { col: anchorPad.col - 1, row: anchorPad.row - 1 },
    ];

    for (const candidate of candidates) {
      const pads = [
        getPadByGrid(candidate.col, candidate.row),
        getPadByGrid(candidate.col + 1, candidate.row),
        getPadByGrid(candidate.col, candidate.row + 1),
        getPadByGrid(candidate.col + 1, candidate.row + 1),
      ];
      if (pads.some((pad) => !pad)) {
        continue;
      }
      if (requireFree && pads.some((pad) => !!pad.towerId)) {
        continue;
      }
      return pads;
    }

    return null;
  };

  const getTowerCenterFromPads = (pads) => ({
    x: pads.reduce((sum, pad) => sum + pad.x, 0) / pads.length,
    y: pads.reduce((sum, pad) => sum + pad.y, 0) / pads.length,
  });

  const syncTowerBlueprintRuntime = (tower) => {
    const blueprint = TOWER_BLUEPRINTS[tower?.blueprintId];
    if (!tower || !blueprint) {
      return;
    }

    if (tower.bonusDamageType !== blueprint.bonusDamageType) {
      tower.bonusDamageType = blueprint.bonusDamageType ?? null;
    }
    if (tower.bonusSpecialText !== blueprint.bonusSpecialText) {
      tower.bonusSpecialText = blueprint.bonusSpecialText ?? null;
    }
    if (tower.bonusMaxTargetsPerShot !== (Number.isFinite(blueprint.bonusMaxTargetsPerShot) ? blueprint.bonusMaxTargetsPerShot : null)) {
      tower.bonusMaxTargetsPerShot = Number.isFinite(blueprint.bonusMaxTargetsPerShot)
        ? Math.max(1, Math.floor(blueprint.bonusMaxTargetsPerShot))
        : null;
    }
    if (tower.bonusFreezeDuration !== (Number.isFinite(blueprint.bonusFreezeDuration) ? blueprint.bonusFreezeDuration : null)) {
      tower.bonusFreezeDuration = Number.isFinite(blueprint.bonusFreezeDuration)
        ? Math.max(0, Math.floor(blueprint.bonusFreezeDuration))
        : null;
    }

    tower._recalculateEffectiveStats?.();
  };

  const createTowerForPad = (pad, actualCost = null) => {
    if (!selectedTowerType) {
      return false;
    }

    const blueprint = TOWER_BLUEPRINTS[selectedTowerType];
    if (!blueprint) {
      return false;
    }

    const footprintPads = blueprint.isAuraTower ? getAuraPlacementPads(pad, true) : [pad];
    if (!footprintPads || footprintPads.length === 0) {
      return false;
    }

    const center = getTowerCenterFromPads(footprintPads);

    const id = `T${nextTowerNum++}`;
    const tower = new Tower({
      id,
      x: center.x,
      y: center.y,
      baseCost: blueprint.cost,
      investedGold: actualCost ?? blueprint.cost,
      range: blueprint.range,
      damage: blueprint.damage,
      attackCd: blueprint.attackCd,
      damageType: blueprint.damageType,
      bonusDamageType: blueprint.bonusDamageType,
      color: blueprint.color,
      blueprintId: selectedTowerType,
      minAttackCd: blueprint.minAttackCd,
      xpBase: blueprint.xpBase,
      xpGrowth: blueprint.xpGrowth,
      specialText: blueprint.specialText,
      bonusSpecialText: blueprint.bonusSpecialText,
      hitsAllInRange: blueprint.hitsAllInRange,
      burnOnHit: blueprint.burnOnHit,
      maxTargetsPerShot: blueprint.maxTargetsPerShot,
      bonusMaxTargetsPerShot: blueprint.bonusMaxTargetsPerShot,
      splashRadius: blueprint.splashRadius,
      freezeDuration: blueprint.freezeDuration,
      bonusFreezeDuration: blueprint.bonusFreezeDuration,
      iceSlowDuration: blueprint.iceSlowDuration,
      iceSlowMul: blueprint.iceSlowMul,
      burnReductionOnFreezeHit: blueprint.burnReductionOnFreezeHit,
      burnReductionOnFreezeSplash: blueprint.burnReductionOnFreezeSplash,
      poisonOnHit: blueprint.poisonOnHit,
      poisonSlowDuration: blueprint.poisonSlowDuration,
      poisonSlowMul: blueprint.poisonSlowMul,
      splashDamageRatio: blueprint.splashDamageRatio,
      targetGroundOnly: blueprint.targetGroundOnly,
      targetAirOnly: blueprint.targetAirOnly,
      maxLevelStunChance: blueprint.maxLevelStunChance,
      stunDuration: blueprint.stunDuration,
      ricochetByLevel: blueprint.ricochetByLevel,
      ricochetRadius: blueprint.ricochetRadius,
      ricochetDamageRatio: blueprint.ricochetDamageRatio,
      ricochetMaxLevelBonus: blueprint.ricochetMaxLevelBonus,
      maxLevelMultiShot: blueprint.maxLevelMultiShot,
      hasEyes: blueprint.hasEyes,
      revealInvisible: canTowerReveal(selectedTowerType),
      bonusLevelThreshold: runBonuses.bonusLevelThreshold,
      maxLevel: runBonuses.towerMaxLevel,
      startLevel: blueprint.startLevel,
      itemSlots: blueprint.itemSlots,
      isAuraTower: blueprint.isAuraTower,
      footprintWidth: blueprint.footprintWidth,
      footprintHeight: blueprint.footprintHeight,
      initialAuraEffect: blueprint.initialAuraEffect,
      upgradeConfig: blueprint.upgrade,
      bus,
    });
    tower.setRunBonuses({
      damageMul: runBonuses.bonusTowerDamageMul,
      rangeMul: runBonuses.bonusTowerRangeMul,
      attackSpeedMul: runBonuses.bonusTowerAttackSpeedMul,
      maxLevel: runBonuses.towerMaxLevel,
      revealInvisible: canTowerReveal(selectedTowerType),
    });
    tower.padIds = footprintPads.map((entry) => entry.id);
    towers.push(tower);
    for (const footprintPad of footprintPads) {
      footprintPad.towerId = id;
    }
    return true;
  };

  const tryBuildOnSelectedEmptyPad = () => {
    if (!selectedTowerType || !selectedPadId) {
      return false;
    }

    const pad = buildPads.find((p) => p.id === selectedPadId) ?? null;
    const blueprint = TOWER_BLUEPRINTS[selectedTowerType];
    const requiredPads = blueprint?.isAuraTower ? getAuraPlacementPads(pad, true) : (pad ? [pad] : null);
    if (!pad || pad.towerId || !requiredPads) {
      if (blueprint?.isAuraTower) {
        buildMessage = "La tour Aura a besoin de 4 pads libres en bloc 2x2";
      }
      return false;
    }

    const cost = getTowerPurchaseCost(selectedTowerType);
    if (gold < cost) {
      buildMessage = `Or insuffisant (${gold}/${cost})`;
      return false;
    }

    gold -= cost;
    const created = createTowerForPad(pad, cost);
    if (!created) {
      gold += cost;
      return false;
    }

    buildMessage = `Tour ${TOWER_BLUEPRINTS[selectedTowerType].label} construite sur ${pad.id} (-${cost}g)`;
    syncSidePanelMode();
    return true;
  };

  const syncSidePanelMode = () => {
    const selectedPad = selectedPadId ? buildPads.find((p) => p.id === selectedPadId) ?? null : null;
    const hasTower = !!selectedPad?.towerId;
    ui.towerBuildGroup.classList.toggle("hidden", hasTower);
    ui.towerManageGroup.classList.toggle("hidden", !hasTower);
  };

  const clearCurrentSelection = () => {
    selectedPadId = null;
    selectedTowerType = null;
    hoveredPadId = null;
    resetManualItemFlow();
    buildMessage = "Selection annulee";
    syncSidePanelMode();
    applyControlsUi();
  };

  const isPointWithinTowerRange = (tower, position) => {
    if (!tower || !position) {
      return false;
    }
    const dx = tower.position.x - position.x;
    const dy = tower.position.y - position.y;
    return dx * dx + dy * dy <= tower.range * tower.range;
  };

  const isPadTouchedByAura = (auraTower, pad) => {
    if (!auraTower || !pad) {
      return false;
    }
    const dx = auraTower.position.x - pad.x;
    const dy = auraTower.position.y - pad.y;
    const auraRadius = auraTower.range + BUILD_PAD_RADIUS;
    return dx * dx + dy * dy <= auraRadius * auraRadius;
  };

  const isTowerTouchedByAura = (auraTower, tower) => {
    if (!auraTower || !tower) {
      return false;
    }
    if (!Array.isArray(tower.padIds) || tower.padIds.length === 0) {
      return isPointWithinTowerRange(auraTower, tower.position);
    }
    return tower.padIds.some((padId) => isPadTouchedByAura(auraTower, buildPads.find((pad) => pad.id === padId) ?? null));
  };

  const getActiveAuraTowers = () => towers.filter((tower) => tower.isAuraTower && tower.level >= 1);

  const getAuraReduceMultiplierAtPosition = (position) => {
    let costMul = 1;
    for (const auraTower of getActiveAuraTowers()) {
      if (!isPointWithinTowerRange(auraTower, position) || auraTower.selectedAuraEffect !== "reduce") {
        continue;
      }
      costMul *= getAuraEffectValues("reduce", auraTower.level).costMul;
    }
    return Math.max(0.25, costMul);
  };

  const getAuraCresusBonusAtPosition = (position) => {
    let goldMul = 1;
    let rarityChance = 0;
    for (const auraTower of getActiveAuraTowers()) {
      if (!isPointWithinTowerRange(auraTower, position) || auraTower.selectedAuraEffect !== "cresus") {
        continue;
      }
      const values = getAuraEffectValues("cresus", auraTower.level);
      goldMul *= values.goldMul;
      rarityChance = Math.max(rarityChance, values.rarityChance);
    }
    return { goldMul, rarityChance };
  };

  const getTowerUpgradeCostWithAura = (tower) => {
    if (!tower) {
      return 0;
    }
    const baseCost = tower.getUpgradeCost();
    if (baseCost <= 0) {
      return 0;
    }
    const reduceMul = getAuraReduceMultiplierAtPosition(tower.position);
    return Math.max(1, Math.floor(baseCost * reduceMul));
  };

  const applyCreepAurasToTowers = () => {
    for (const tower of towers) {
      tower.resetAuraEffects();
    }
    for (const creep of creeps) {
      creep.resetAuraEffects?.();
    }

    for (const auraTower of getActiveAuraTowers()) {
      const values = getAuraEffectValues(auraTower.selectedAuraEffect, auraTower.level);
      const effectLabel = getAuraDisplayEffectName(auraTower.selectedAuraEffect);
      const effectInfo = getAuraEffectData(auraTower.selectedAuraEffect, auraTower.level, auraTower.range);
      const detail = effectInfo.summary.replaceAll(",", " •");

      for (const tower of towers) {
        if (tower.id === auraTower.id) {
          continue;
        }
        if (!isTowerTouchedByAura(auraTower, tower)) {
          continue;
        }

        tower.applyAuraEffects({
          damageMul: values.damageMul,
          attackSpeedMul: values.attackSpeedMul,
          rangeMul: values.rangeMul,
          forceChaos: values.chaos,
          detail,
          markAura: true,
        });
      }

      for (const creep of creeps) {
        if (!creep.isAlive() || !isPointWithinTowerRange(auraTower, creep.position)) {
          continue;
        }

        if (values.moveMul < 1) {
          creep.applyAuraSlow?.(values.moveMul, detail);
        }
        if (values.armorReduction > 0) {
          creep.applyAuraArmorReduction?.(values.armorReduction, detail);
        }
        if (values.reveal) {
          creep.reveal?.(0.35);
          creep.applyAuraReveal?.(detail);
        }
        if (values.web && String(creep.waveType ?? "").toUpperCase() === "AIR") {
          creep.applyWebGrounding?.(detail);
        }
        if (values.boost) {
          creep.applyBoostAura?.(detail);
        }
      }
    }

    for (const creep of creeps) {
      if (!creep.isAlive() || !creep.hasSlowAura || creep.slowAuraRadius <= 0) {
        continue;
      }

      const radiusSq = creep.slowAuraRadius * creep.slowAuraRadius;
      for (const tower of towers) {
        const dx = tower.position.x - creep.position.x;
        const dy = tower.position.y - creep.position.y;
        if (dx * dx + dy * dy <= radiusSq) {
          tower.applyCreepSlowAura(0.5);
        }
      }
    }
  };

  const upgradeSelectedPadTower = () => {
    if (!selectedPadId) {
      buildMessage = "Aucun pad selectionne pour upgrade";
      return;
    }

    const pad = buildPads.find((p) => p.id === selectedPadId) ?? null;
    if (!pad || !pad.towerId) {
      buildMessage = "Le pad selectionne ne contient pas de tour";
      return;
    }

    const tower = towers.find((t) => t.id === pad.towerId) ?? null;
    if (!tower) {
      buildMessage = "Tour introuvable";
      return;
    }

    const cost = getTowerUpgradeCostWithAura(tower);
    if (cost <= 0) {
      buildMessage = `Tour ${tower.id} deja au niveau max (${tower.level})`;
      return;
    }

    if (gold < cost) {
      buildMessage = `Or insuffisant upgrade (${gold}/${cost})`;
      return;
    }

    gold -= cost;
    const upgraded = tower.upgrade();
    if (!upgraded) {
      buildMessage = `Upgrade impossible pour ${tower.id}`;
      gold += cost;
      return;
    }
    buildMessage = `Upgrade ${tower.id} -> L${tower.level} (-${cost}g)`;
  };

  const removeTowerFromPad = (pad) => {
    const idx = towers.findIndex((t) => t.id === pad.towerId);
    if (idx < 0) {
      pad.towerId = null;
      return false;
    }

    const [tower] = towers.splice(idx, 1);
    for (const buildPad of buildPads) {
      if (buildPad.towerId === tower?.id) {
        buildPad.towerId = null;
      }
    }
    return true;
  };

  const findNearestUpgradeableTower = (sourceTower, maxRadius = Number.POSITIVE_INFINITY) => {
    if (!sourceTower) {
      return null;
    }

    let nearestTower = null;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    const maxRadiusSq = maxRadius * maxRadius;

    for (const tower of towers) {
      if (tower.id === sourceTower.id || tower.level >= tower.maxLevel) {
        continue;
      }

      const dx = tower.position.x - sourceTower.position.x;
      const dy = tower.position.y - sourceTower.position.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > maxRadiusSq) {
        continue;
      }
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestTower = tower;
      }
    }

    return nearestTower;
  };

  const creeps = [];
  let tick = 0;
  let creepId = 1;

  const finalizeCreepRemoval = (id, reason) => {
    const idx = creeps.findIndex((c) => c.id === id);
    if (idx < 0) {
      return null;
    }

    const creep = creeps[idx];
    creeps.splice(idx, 1);
    creep.alive = false;
    creep.destroyed = true;
    creep.destroyReason = reason;
    return creep;
  };

  bus.on("creep:reached-end", ({ id, leakDamage = 1 }) => {
    const leakedCreep = finalizeCreepRemoval(id, "reached-end");
    if (leakedCreep) {
      creepsLeakedInWave += 1;
      const leakedWaveLevel = Number.isFinite(leakedCreep.waveLevel) ? leakedCreep.waveLevel : currentWaveLevel;
      const progress = waveProgress.get(leakedWaveLevel) ?? { total: 0, killed: 0, leaked: 0 };
      progress.leaked = Math.min(progress.total, (progress.leaked ?? 0) + 1);
      waveProgress.set(leakedWaveLevel, progress);
      portalLives = Math.max(0, portalLives - Math.max(1, Math.floor(leakDamage)));
    }
  });

  bus.on("creep:killed", ({ id, sourceTowerId }) => {
    const deadCreep = finalizeCreepRemoval(id, "killed");
    if (deadCreep) {
      creepsKilledInWave += 1;
      totalKills += 1;
      const killedWaveLevel = Number.isFinite(deadCreep.waveLevel)
        ? deadCreep.waveLevel
        : currentWaveLevel;
      const progress = waveProgress.get(killedWaveLevel) ?? { total: 0, killed: 0 };
      progress.killed = Math.min(progress.total, progress.killed + 1);
      waveProgress.set(killedWaveLevel, progress);
      const sourceWave = generatedWaves.get(killedWaveLevel) ?? null;
      const waveUnits = sourceWave?.unitCount ?? waveProgress.get(killedWaveLevel)?.total ?? 1;
      const baseKillGold = getBaseKillGoldForWave(killedWaveLevel, waveUnits);
      const reward = Math.max(
        1,
        Math.floor(baseKillGold * (deadCreep.bountyMultiplier ?? 1) * (runBonuses.bonusKillGoldMul ?? 1)),
      );
      gold += reward;
      score += scoreBonus(reward * 2);

      const droppedItem = deadCreep.plannedDropItem ?? itemSystem.rollDrop(killedWaveLevel, {
        excludedUniqueSourceIds: getOwnedUniqueSourceIds(),
        difficulty: activeDifficulty,
      });
      if (droppedItem) {
        pushItemToStash(droppedItem);
      }

      const killer = towers.find((t) => t.id === sourceTowerId) ?? null;
      if (killer) {
        const xpGain = Math.max(1, Math.floor(deadCreep.maxHp * 0.02 * (runBonuses.bonusTowerXpMul ?? 1)));
        let xpReceiver = killer.level >= killer.maxLevel ? null : killer;
        if (!xpReceiver && runBonuses.linkerUnlocked) {
          xpReceiver = findNearestUpgradeableTower(killer, runBonuses.linkerRadius) ?? null;
        }

        if (xpReceiver) {
          const leveled = xpReceiver.grantXp(xpGain);
          if (leveled) {
            buildMessage = `${xpReceiver.id} monte niveau ${xpReceiver.level}`;
          } else if (xpReceiver.id !== killer.id) {
            buildMessage = `EXP redirigee ${killer.id} -> ${xpReceiver.id}`;
          }
        }

        if (stash.length > 0 && killer.canAddItem() && !isManualItemFlowActive()) {
          const item = takeStashItemAt(0);
          if (item) {
            killer.addItem(item);
            buildMessage = `${killer.id} equipe ${item.name}`;
          }
        }
      }
    }
  });

  bus.on("autocast:triggered", ({ towerId, autocastId }) => {
    buildMessage = `Autocast ${autocastId} sur ${towerId}`;
  });

  bus.on("boss:phase-changed", ({ phase }) => {
    currentBossPhase = phase;
    buildMessage = `Boss phase ${phase}`;
  });

  bus.on("boss:ability", ({ ability, portalDamage }) => {
    if (ability === "rupture") {
      buildMessage = `Boss rupture -${portalDamage ?? 1} vie portail`;
      return;
    }
    buildMessage = `Boss ability: ${ability}`;
  });

  bus.on("wave:spawn-finished", ({ waveId }) => {
    if (waveId === currentWaveLevel) {
      waveSpawnFinished = true;
    }
  });

  bus.on("tower:attack", ({ towerId, targetId, damage }) => {
    combatLastHit = `${towerId} -> C${targetId} (${Math.round(damage)})`;
  });

  ui.runOverlay.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !awaitingVictoryChoice) {
      return;
    }

    if (button.id === "overlayContinueBtn") {
      endlessMode = true;
      awaitingVictoryChoice = false;
      gamePaused = false;
      hideRunOverlay();
      buildMessage = "Extreme debloque. Run continue au-dela de la vague 500.";
      applyControlsUi();
      return;
    }

    if (button.id === "overlayQuitBtn") {
      awaitingVictoryChoice = false;
      gameEnded = true;
      victory = true;
      buildMessage = "Run terminee apres le palier 500.";
      applyControlsUi();
    }
  });

  ui.pauseBtn.addEventListener("click", () => {
    gamePaused = !gamePaused;
    applyControlsUi();
  });
  ui.speedBtn.addEventListener("click", () => {
    const idx = speedValues.indexOf(speedLevel);
    speedLevel = speedValues[(idx + 1) % speedValues.length];
    applyControlsUi();
  });
  ui.waveBtn.addEventListener("click", () => {
    if (gameEnded) {
      return;
    }

    if (preWaveActive) {
      preWaveActive = false;
      preWaveRemainingMs = 0;
      currentWaveLevel = 1;
      startWave(currentWaveLevel);
      buildMessage = "Lancement manuel: vague 1 demarree (bonus vague 0: +0 or)";
      applyControlsUi();
      return;
    }

    const ratio = getCurrentWaveRemainingRatio();
    const earlyBonus = Math.floor(
      getWaveCompletionReward(currentWaveLevel + 1) * ratio * getEarlyLaunchBonusMultiplier(activeDifficulty),
    );
    if (earlyBonus > 0) {
      gold += earlyBonus;
      score += scoreBonus(earlyBonus * 5);
    }

    const previousWave = currentWaveLevel;
    currentWaveLevel += 1;
    startWave(currentWaveLevel);
    buildMessage = `Lancement anticipe vague ${currentWaveLevel} (+${earlyBonus} or, ${Math.round(ratio * 100)}% non tue vague ${previousWave})`;
    applyControlsUi();
  });
  ui.autoBtn.addEventListener("click", () => {
    autoWave = !autoWave;
    applyControlsUi();
  });
  ui.waveInfoBtn.addEventListener("click", () => {
    setWaveInfoOpen(!waveInfoOpen);
  });
  ui.waveInfoPanel.addEventListener("mouseover", (event) => {
    const term = event.target.closest(".wave-info-panel__term");
    if (!term) {
      return;
    }
    showInfoHoverCard(getWaveTermTooltip(term.dataset.waveTerm, term.dataset.waveValue), event);
  });
  ui.waveInfoPanel.addEventListener("mousemove", (event) => {
    const term = event.target.closest(".wave-info-panel__term");
    if (!term) {
      return;
    }
    positionInfoHoverCard(event);
  });
  ui.waveInfoPanel.addEventListener("mouseleave", () => {
    hideInfoHoverCard();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (waveInfoOpen && target instanceof Node) {
      if (!ui.waveInfoPanel.contains(target) && !ui.waveInfoBtn.contains(target)) {
        setWaveInfoOpen(false);
      }
    }
    if (inventoryPanelOpen && target instanceof Node) {
      const isInventoryToggle = ui.inventoryBtn.contains(target)
        || ui.craftBtn.contains(target)
        || ui.towerAddItemBtn.contains(target)
        || (target instanceof Element && !!target.closest("[data-tower-action='open-stash']"));
      if (!ui.inventoryPanel.contains(target) && !isInventoryToggle) {
        toggleInventoryPanel(false);
      }
    }
  });
  ui.inventoryPanel.addEventListener("click", (event) => {
    if (event.target === ui.inventoryPanel) {
      toggleInventoryPanel(false);
      return;
    }

    const closeButton = event.target.closest("#inventoryCloseBtn");
    if (closeButton && ui.inventoryPanel.contains(closeButton)) {
      event.preventDefault();
      event.stopPropagation();
      toggleInventoryPanel(false);
    }
  });
  const onPickTower = (towerId) => {
    if (!TOWER_BLUEPRINTS[towerId]) {
      return;
    }
    if (!isTowerUnlockedByKnowledge(towerId)) {
      buildMessage = "Cette tour est verrouillée: débloque pack architect";
      applyControlsUi();
      return;
    }

    if (selectedTowerType === towerId) {
      selectedTowerType = null;
      buildMessage = "Selection tour annulee";
      applyControlsUi();
      return;
    }

    selectedTowerType = towerId;
    const built = tryBuildOnSelectedEmptyPad();
    if (!built) {
      buildMessage = `Tour selectionnee: ${TOWER_BLUEPRINTS[towerId].label}`;
    }
    applyControlsUi();
  };

  ui.towerSentinelBtn.addEventListener("click", () => onPickTower("sentinel"));
  ui.towerPyroBtn.addEventListener("click", () => onPickTower("pyro"));
  ui.towerArcBtn.addEventListener("click", () => onPickTower("arc"));
  ui.towerFrozenBtn.addEventListener("click", () => onPickTower("frozen"));
  ui.towerRonceBtn.addEventListener("click", () => onPickTower("ronce"));
  ui.towerCanonBtn.addEventListener("click", () => onPickTower("cannon"));
  ui.towerRicochetBtn.addEventListener("click", () => onPickTower("ricochet"));
  ui.towerMachinegunBtn.addEventListener("click", () => onPickTower("machinegun"));
  ui.towerScorpioBtn.addEventListener("click", () => onPickTower("scorpio"));
  ui.towerAuraBtn.addEventListener("click", () => onPickTower("aura"));

  ui.towerSentinelBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("sentinel", event);
  });
  ui.towerPyroBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("pyro", event);
  });
  ui.towerArcBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("arc", event);
  });
  ui.towerFrozenBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("frozen", event);
  });
  ui.towerRonceBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("ronce", event);
  });
  ui.towerCanonBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("cannon", event);
  });
  ui.towerRicochetBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("ricochet", event);
  });
  ui.towerMachinegunBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("machinegun", event);
  });
  ui.towerScorpioBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("scorpio", event);
  });
  ui.towerAuraBtn.addEventListener("mouseenter", (event) => {
    showTowerHoverCard("aura", event);
  });
  ui.towerSentinelBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerPyroBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerArcBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerFrozenBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerRonceBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerCanonBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerRicochetBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerMachinegunBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerScorpioBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerAuraBtn.addEventListener("mousemove", (event) => positionTowerHoverCard(event));
  ui.towerSentinelBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerPyroBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerArcBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerFrozenBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerRonceBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerCanonBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerRicochetBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerMachinegunBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerScorpioBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });
  ui.towerAuraBtn.addEventListener("mouseleave", () => {
    hideTowerHoverCard();
  });

  ui.playerProgressBadge.addEventListener("mouseenter", (event) => {
    showInfoHoverCard(getPlayerProgressTooltip(), event);
  });
  ui.playerProgressBadge.addEventListener("mousemove", (event) => positionInfoHoverCard(event));
  ui.playerProgressBadge.addEventListener("mouseleave", () => hideInfoHoverCard());

  ui.wisdomBtn.addEventListener("click", () => {
    toggleKnowledgePanel();
  });
  ui.knowledgePanel.addEventListener("click", (event) => {
    if (event.target === ui.knowledgePanel) {
      toggleKnowledgePanel(false);
      return;
    }

    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    if (button.id === "knowledgeCloseBtn") {
      event.preventDefault();
      event.stopPropagation();
      toggleKnowledgePanel(false);
      return;
    }

    const key = button.dataset.knowledgeKey;
    if (!key) {
      return;
    }

    const purchased = purchaseKnowledge(key);
    if (!purchased) {
      buildMessage = "Sagesse insuffisante ou connaissance deja maxee";
      applyControlsUi();
    }
  });
  ui.knowledgePanel.addEventListener("mouseover", (event) => {
    const entry = event.target.closest(".knowledge-panel__entry");
    if (!entry) {
      return;
    }

    const key = entry.dataset.knowledgeKey ?? "connaissance";
    const tooltip = entry.dataset.knowledgeTooltip ?? "Connaissance";
    showInfoHoverCard(
      {
        title: key,
        lines: tooltip.split("\n"),
        accent: "#4ec9b0",
      },
      event,
    );
  });
  ui.knowledgePanel.addEventListener("mousemove", (event) => {
    const entry = event.target.closest(".knowledge-panel__entry");
    if (!entry) {
      return;
    }
    positionInfoHoverCard(event);
  });
  ui.knowledgePanel.addEventListener("mouseleave", () => {
    hideInfoHoverCard();
  });

  const resolveItemChip = (chip) => {
    const source = chip?.dataset?.itemSource ?? "";
    const index = Number(chip?.dataset?.itemIndex ?? -1);
    if (!Number.isFinite(index) || index < 0) {
      return null;
    }

    if (source === "stash") {
      return stash[index] ?? null;
    }

    if (source === "equipped") {
      const equippedItems = getEquippedItems();
      return equippedItems[index]?.item ?? null;
    }

    if (source === "shop") {
      return shopInventory[index] ?? null;
    }

    if (source.startsWith("tower:")) {
      const towerId = source.slice(6);
      const tower = towers.find((entry) => entry.id === towerId) ?? null;
      return tower?.items[index] ?? null;
    }

    return null;
  };

  const showItemTooltip = (chip, event, contextText = "") => {
    const item = resolveItemChip(chip);
    if (!item) {
      return;
    }
    showInfoHoverCard(getItemTooltip(item, contextText), event);
  };

  ui.towerStats.addEventListener("mouseover", (event) => {
    const towerAction = event.target.closest(".item-group__icon-btn");
    if (towerAction && ui.towerStats.contains(towerAction)) {
      showInfoHoverCard({ title: "Ajouter un objet", lines: ["Ouvre l'inventaire du joueur pour équiper cette tour."], accent: getSelectedTower()?.color ?? "#93c5fd" }, event);
      return;
    }

    const statAction = event.target.closest(".item-action-btn");
    if (statAction && ui.towerStats.contains(statAction) && (statAction.dataset.itemAction ?? "") === "remove-tower-item") {
      showInfoHoverCard({ title: "Retirer", lines: ["Retirer l'objet et le renvoyer dans l'inventaire joueur."], accent: "#f87171" }, event);
      return;
    }

    const chip = event.target.closest(".item-chip");
    if (chip && ui.towerStats.contains(chip)) {
      showItemTooltip(chip, event, chip.textContent?.trim() ?? "Objet equipe");
      return;
    }

    const selectedTower = getSelectedTower();
    if (!selectedTower) {
      return;
    }

    const otherSegment = event.target.closest(".tower-stat__segment");
    if (otherSegment && ui.towerStats.contains(otherSegment)) {
      showInfoHoverCard(getTowerOtherSegmentTooltip(otherSegment.dataset.otherSegment ?? ""), event);
      return;
    }

    const statValue = event.target.closest(".tower-stat__value[data-stat-key]");
    if (!statValue || !ui.towerStats.contains(statValue)) {
      return;
    }

    if (statValue.dataset.statKey === "level") {
      showInfoHoverCard(getTowerLevelTooltip(selectedTower), event);
      return;
    }

    if (statValue.dataset.statKey === "attack") {
      showInfoHoverCard(getTowerAttackTooltip(selectedTower), event);
      return;
    }

    if (statValue.dataset.statKey === "dps") {
      showInfoHoverCard(getTowerDpsTooltip(selectedTower), event);
    }
  });
  ui.towerStats.addEventListener("mousemove", (event) => {
    const towerAction = event.target.closest(".item-group__icon-btn");
    const statAction = event.target.closest(".item-action-btn");
    const chip = event.target.closest(".item-chip");
    const otherSegment = event.target.closest(".tower-stat__segment");
    const statValue = event.target.closest(".tower-stat__value[data-stat-key]");
    if (
      (!towerAction || !ui.towerStats.contains(towerAction))
      && (!statAction || !ui.towerStats.contains(statAction))
      && (!chip || !ui.towerStats.contains(chip))
      && (!otherSegment || !ui.towerStats.contains(otherSegment))
      && (!statValue || !ui.towerStats.contains(statValue))
    ) {
      return;
    }
    positionInfoHoverCard(event);
  });
  ui.towerStats.addEventListener("mouseleave", () => {
    hideInfoHoverCard();
  });
  ui.towerStats.addEventListener("pointerdown", (event) => {
    const towerAction = event.target.closest(".item-group__icon-btn");
    if (towerAction && ui.towerStats.contains(towerAction) && towerAction.dataset.towerAction === "open-stash") {
      event.preventDefault();
      event.stopPropagation();
      const tower = getSelectedTower();
      if (!tower || !tower.canAddItem() || stash.length === 0) {
        return;
      }
      pendingTowerItemTargetId = tower.id;
      pendingTowerSelectionItemId = null;
      toggleInventoryPanel(true, "inventory");
      buildMessage = `Choisissez un objet pour ${tower.id}`;
      applyControlsUi();
      return;
    }

    const actionButton = event.target.closest(".item-action-btn");
    if (actionButton && ui.towerStats.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.itemAction ?? "";
      const source = actionButton.dataset.itemSource ?? "";
      const index = Number(actionButton.dataset.itemIndex ?? -1);
      if (action === "remove-tower-item" && source.startsWith("tower:") && Number.isFinite(index) && index >= 0) {
        removeTowerItemToStash(source.slice(6), index);
      }
      return;
    }
  });

  ui.inventoryPanel.addEventListener("mouseover", (event) => {
    const actionButton = event.target.closest(".item-action-btn");
    if (actionButton && ui.inventoryPanel.contains(actionButton)) {
      if ((actionButton.dataset.itemAction ?? "") === "remove-tower-item") {
        showInfoHoverCard(
          { title: "Retirer", lines: ["Retirer l'objet et le renvoyer dans l'inventaire joueur."], accent: "#f87171" },
          event,
        );
        return;
      }
    }
    const chip = event.target.closest(".item-chip");
    if (!chip || !ui.inventoryPanel.contains(chip)) {
      return;
    }
    const contextText = chip.dataset.itemSource === "equipped"
      ? "Objet equipe"
      : chip.dataset.itemSource === "shop"
        ? "Objet de boutique"
        : "Objet obtenu";
    showItemTooltip(chip, event, contextText);
  });
  ui.inventoryPanel.addEventListener("mousemove", (event) => {
    const chip = event.target.closest(".item-chip");
    if (!chip || !ui.inventoryPanel.contains(chip)) {
      return;
    }
    positionInfoHoverCard(event);
  });
  ui.inventoryPanel.addEventListener("mouseleave", () => {
    hideInfoHoverCard();
  });

  ui.inventoryPanel.addEventListener("click", (event) => {
    const actionButton = event.target.closest(".item-action-btn");
    if (!actionButton || !ui.inventoryPanel.contains(actionButton)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const source = actionButton.dataset.itemSource ?? "";
    const index = Number(actionButton.dataset.itemIndex ?? -1);
    const action = actionButton.dataset.itemAction ?? "";

    if (!Number.isFinite(index) || index < 0) {
      return;
    }

    if (source === "stash" && action === "sell-stash") {
      sellStashItem(index);
      return;
    }

    if (source === "stash" && action === "pick-tower-for-item") {
      const item = stash[index] ?? null;
      if (!item) {
        return;
      }
      pendingTowerSelectionItemId = item.id;
      pendingTowerItemTargetId = null;
      toggleInventoryPanel(false, inventoryPanelMode, true);
      buildMessage = `Choisissez la tour qui recevra ${item.name} (clic droit pour annuler)`;
      applyControlsUi();
      return;
    }

    if (source === "stash" && action === "cancel-pick-tower") {
      resetManualItemFlow();
      buildMessage = "Distribution annulee";
      refreshInventoryPanelIfOpen();
      applyControlsUi();
      return;
    }

    if (source === "stash" && action === "equip-target-tower" && pendingTowerItemTargetId) {
      equipStashItemToTower(index, pendingTowerItemTargetId);
      return;
    }

    if (source === "equipped" && action === "remove-equipped") {
      const equippedItems = getEquippedItems();
      const entry = equippedItems[index] ?? null;
      if (!entry) {
        return;
      }
      removeTowerItemToStash(entry.towerId, entry.itemIndex);
      return;
    }

    if (source === "shop" && action === "buy-shop") {
      buyShopItem(index);
    }
  });

  ui.craftBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isShopUnlocked()) {
      buildMessage = "Boutique verrouillée: débloque la connaissance shop";
      applyControlsUi();
      return;
    }
    toggleInventoryPanel(true, "shop");
    buildMessage = "Boutique ouverte";
    applyControlsUi();
  });

  ui.inventoryBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInventoryPanel(!inventoryPanelOpen || inventoryPanelMode !== "inventory", "inventory");
    buildMessage = stash.length > 0 ? `Inventaire: ${stash.length} objets` : "Inventaire vide";
    applyControlsUi();
  });
  ui.towerAddItemBtn.addEventListener("click", () => {
    const tower = getSelectedTower();
    if (!tower) {
      buildMessage = "Selectionne une tour";
      return;
    }
    if (!tower.canAddItem()) {
      buildMessage = `${tower.id} a un inventaire plein`;
      return;
    }
    if (stash.length === 0) {
      buildMessage = "Inventaire joueur vide";
      return;
    }

    pendingTowerItemTargetId = tower.id;
    pendingTowerSelectionItemId = null;
    toggleInventoryPanel(true, "inventory");
    buildMessage = `Choisissez un objet pour ${tower.id}`;
    applyControlsUi();
  });
  ui.orderBtn.addEventListener("mouseenter", (event) => {
    showInfoHoverCard(getOrderTooltip(getSelectedTower()), event);
  });
  ui.orderBtn.addEventListener("mousemove", (event) => positionInfoHoverCard(event));
  ui.orderBtn.addEventListener("mouseleave", () => hideInfoHoverCard());
  ui.orderBtn.addEventListener("mouseenter", (event) => {
    showInfoHoverCard(getOrderTooltip(getSelectedTower()), event);
  });
  ui.orderBtn.addEventListener("mousemove", (event) => positionInfoHoverCard(event));
  ui.orderBtn.addEventListener("mouseleave", () => hideInfoHoverCard());
  ui.upgradeBtn.addEventListener("click", () => {
    upgradeSelectedPadTower();
    refreshRuntimeUi();
  });
  ui.upgradeBtn.addEventListener("mouseenter", () => {
    showUpgradePreview = true;
  });
  ui.upgradeBtn.addEventListener("mouseleave", () => {
    showUpgradePreview = false;
  });
  ui.sellBtn.addEventListener("click", () => {
    if (!selectedPadId) {
      buildMessage = "Aucun pad selectionne pour vendre";
      return;
    }

    const pad = buildPads.find((p) => p.id === selectedPadId) ?? null;
    if (!pad || !pad.towerId) {
      buildMessage = "Le pad selectionne ne contient pas de tour";
      syncSidePanelMode();
      return;
    }

    const tower = towers.find((t) => t.id === pad.towerId) ?? null;
    const sold = removeTowerFromPad(pad);
    if (!sold) {
      buildMessage = `Echec vente ${pad.id}`;
      return;
    }

    for (const item of tower?.items ?? []) {
      pushItemToStash(item);
    }
    if (pendingTowerItemTargetId === tower?.id) {
      resetManualItemFlow();
    }

    const refund = getSellRefund(tower);
    gold += refund;
    score = Math.max(0, score - Math.floor(refund * 0.2));
    buildMessage = `Tour vendue sur ${pad.id} (+${refund} or, 75% investi)`;
    syncSidePanelMode();
    refreshRuntimeUi();
  });

  ui.orderBtn.addEventListener("click", () => {
    if (!selectedPadId) {
      buildMessage = "Aucun pad selectionne";
      return;
    }

    const pad = buildPads.find((p) => p.id === selectedPadId) ?? null;
    if (!pad || !pad.towerId) {
      buildMessage = "Selectionne un pad avec une tour";
      return;
    }

    const tower = towers.find((t) => t.id === pad.towerId) ?? null;
    if (!tower) {
      buildMessage = "Tour introuvable";
      return;
    }

    if (tower.isAuraTower) {
      if (!tower.canChangeAuraEffect?.()) {
        buildMessage = `Effet Aura verrouille: ${getAuraDisplayEffectName(tower.selectedAuraEffect)}`;
        applyControlsUi();
        return;
      }

      const effectModes = getOrderModesForTower(tower);
      const idx = effectModes.indexOf(tower.selectedAuraEffect);
      const next = effectModes[(idx + 1) % effectModes.length];
      tower.setAuraEffect?.(next);
      buildMessage = `Effet Aura: ${getAuraDisplayEffectName(next)}`;
      refreshRuntimeUi();
      return;
    }

    const orderModes = getOrderModesForTower(tower);
    const idx = orderModes.indexOf(tower.targetMode);
    const next = orderModes[(idx + 1) % orderModes.length];
    tower.setTargetMode(next);
    buildMessage = `Ordre ${tower.id}: ${next}`;
    applyControlsUi();
  });
  ui.resetBtn.addEventListener("click", () => {
    resetRun();
  });
  ui.lockMapBtn.addEventListener("mouseenter", (event) => {
    showInfoHoverCard(getMapLockTooltip(selectedDifficulty), event);
  });
  ui.lockMapBtn.addEventListener("mousemove", (event) => {
    positionInfoHoverCard(event);
  });
  ui.lockMapBtn.addEventListener("mouseleave", () => {
    hideInfoHoverCard();
  });
  ui.lockMapBtn.addEventListener("click", () => {
    mapLocked = !mapLocked;
    buildMessage = mapLocked ? "Map verrouillée pour les prochains resets" : "Verrouillage de map désactivé";
    saveActiveProfileSnapshot();
    applyControlsUi();
  });

  ui.menuStartBtn.addEventListener("click", () => {
    openStartModal();
  });
  ui.menuContinueBtn.addEventListener("click", () => {
    openContinueModal();
  });
  ui.menuExportBtn.addEventListener("click", () => {
    openExportModal();
  });

  ui.importSaveInput.addEventListener("change", async () => {
    const file = ui.importSaveInput.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!String(file.name).toLowerCase().endsWith(".wizisav")) {
      showToast("Fichier invalide: extension .wizisav requise.", "error");
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = saveProfileSystem.importPayload(payload);
      if (!ui.modalLayer.classList.contains("hidden")) {
        hideModal();
        openContinueModal();
      }
      showToast(`Import réussi: ${imported.name}`, "success");
    } catch {
      showToast("Import impossible: format de sauvegarde invalide.", "error");
    }
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " " || key === "spacebar") {
      event.preventDefault();
      event.stopPropagation();
      gamePaused = !gamePaused;
      applyControlsUi();
      return;
    }
    if (key === "u") {
      upgradeSelectedPadTower();
      refreshRuntimeUi();
      return;
    }
    if (key === "r") {
      resetRun();
    }
    if (key === "c") {
      if (!isShopUnlocked()) {
        buildMessage = "Boutique verrouillée: débloque la connaissance shop";
        applyControlsUi();
        return;
      }
      toggleInventoryPanel(true, "shop");
      buildMessage = "Boutique ouverte";
      applyControlsUi();
      return;
    }
  });

  ui.canvas.addEventListener("click", (event) => {
    const pos = canvasToWorld(event);
    const clickedTower = findTowerAt(pos.x, pos.y);
    const pad = findPadAt(pos.x, pos.y);
    const clickedTowerPad = clickedTower?.padIds?.[0]
      ? buildPads.find((entry) => entry.id === clickedTower.padIds[0]) ?? null
      : null;
    const resolvedPad = clickedTowerPad ?? pad;

    if (pendingTowerSelectionItemId) {
      if (!resolvedPad?.towerId) {
        buildMessage = "Selection de tour annulee";
        resetManualItemFlow();
        refreshInventoryPanelIfOpen();
        applyControlsUi();
        return;
      }

      const tower = getTowerById(resolvedPad.towerId);
      const itemIndex = stash.findIndex((item) => item.id === pendingTowerSelectionItemId);
      if (!tower || itemIndex < 0) {
        buildMessage = "Objet ou tour introuvable";
        resetManualItemFlow();
        refreshInventoryPanelIfOpen();
        applyControlsUi();
        return;
      }

      equipStashItemToTower(itemIndex, tower.id);
      applyControlsUi();
      return;
    }

    if (pendingTowerItemTargetId) {
      if (!resolvedPad?.towerId || resolvedPad.towerId !== pendingTowerItemTargetId) {
        buildMessage = "Ajout d'objet annule";
        resetManualItemFlow();
        refreshInventoryPanelIfOpen();
        applyControlsUi();
        return;
      }
    }

    if (!resolvedPad) {
      clearCurrentSelection();
      return;
    }

    selectedPadId = resolvedPad.id;
    syncSidePanelMode();

    if (resolvedPad.towerId) {
      buildMessage = `Pad ${resolvedPad.id} occupe (${resolvedPad.towerId})`;
      return;
    }

    if (!selectedTowerType) {
      buildMessage = `Pad ${resolvedPad.id}: vide (selectionne une tour pour construire)`;
      applyControlsUi();
      return;
    }

    const cost = getTowerPurchaseCost(selectedTowerType, { x: resolvedPad.x, y: resolvedPad.y });
    if (gold < cost) {
      buildMessage = `Or insuffisant (${gold}/${cost})`;
      return;
    }

    gold -= cost;
    const created = createTowerForPad(resolvedPad, cost);
    if (!created) {
      gold += cost;
      return;
    }
    buildMessage = `Tour ${TOWER_BLUEPRINTS[selectedTowerType].label} construite sur ${resolvedPad.id} (-${cost}g)`;
    applyControlsUi();
  });

  ui.canvas.addEventListener("mousemove", (event) => {
    const pos = canvasToWorld(event);
    const pad = findPadAt(pos.x, pos.y);
    hoveredWorldPos = pos;
    hoveredPadId = pad?.id ?? null;

    const hoveredCreep = findHoveredCreep(pos.x, pos.y);
    if (hoveredCreep) {
      showInfoHoverCard(getCreepTooltip(hoveredCreep), event);
      return;
    }

    hideInfoHoverCard();
  });

  ui.canvas.addEventListener("mouseleave", () => {
    hoveredWorldPos = null;
    hoveredPadId = null;
    hideInfoHoverCard();
  });

  ui.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (isManualItemFlowActive()) {
      resetManualItemFlow();
      refreshInventoryPanelIfOpen();
      buildMessage = "Action d'objet annulee";
      applyControlsUi();
      return;
    }
    clearCurrentSelection();
  });

  applyControlsUi();
  resetRun();

  const loop = new FixedStepLoop({
    stepMs: 1000 / 60,
    maxSubSteps: 5,
    update: (dt) => {
      if (!runInitialized) {
        return;
      }

      const now = performance.now();
      const delta = Math.max(0, (now - sessionLastTimestamp) / 1000);
      sessionLastTimestamp = now;
      sessionElapsedSeconds += delta;

      if (gameEnded) {
        const stateText = victory ? "Victoire" : "Defaite";
        ui.runOverlay.dataset.state = victory ? "victory" : "defeat";
        ui.controlInfo.textContent = `Etat: ${stateText} | Score final: ${score} | Appuie sur R pour reset`;
        setTopMainLine();
        return;
      }

      if (portalLives <= 0) {
        gameEnded = true;
        victory = false;
        if (!runResolved) {
          runResolved = true;
          const runMeta = metaSystem.applyRunResult({
            won: false,
            wave: currentWaveLevel,
            kills: totalKills,
            score,
          });
          if ((runMeta?.levelsGained ?? 0) > 0) {
            metaSystem.grantSagesse(runMeta.levelsGained);
            buildMessage = `Défaite, mais progression: +${runMeta.levelsGained} sagesse (niveaux gagnés)`;
          }
          syncMetaSnapshot();
          saveActiveProfileSnapshot();
        }
          showRunOverlay(
            "defeat",
            `Vague ${currentWaveLevel} | Kills ${totalKills} | Score ${score} | Or ${gold}`,
          );
        ui.controlInfo.textContent = "Etat: Defaite (portal 0) | Appuie sur R pour reset";
        setTopMainLine();
        return;
      }

      if (gamePaused) {
        refreshRuntimeUi();
        return;
      }

      if (preWaveActive) {
        preWaveRemainingMs = Math.max(0, preWaveRemainingMs - dt * 1000);
        if (preWaveRemainingMs <= 0) {
          preWaveActive = false;
          currentWaveLevel = 1;
          startWave(currentWaveLevel);
          buildMessage = "Preparation terminee: vague 1 lancee";
        }
        refreshRuntimeUi();
        return;
      }

      const scaledDt = dt * speedLevel;
      tick += 1;

      waveSpawner.update(scaledDt, ({ health, speed, armor, wave, isChampion }) => {
        const mods = activeWaveModifiers ?? { hpMul: 1, speedMul: 1, armorFlat: 0, leakDamage: 1, bossProfile: null };
        const baseHp = Math.floor(health * mods.hpMul);
        const baseArmor = Math.max(0, Math.floor(armor + mods.armorFlat));
        const baseSpeed = speed * mods.speedMul;

        const spawn = rng.pick(spawnPoints);
        const isBoss = wave.mainType === "BOSS";
        const affix = eliteAffixSystem.assign({
          waveLevel: currentWaveLevel,
          isChampion,
          isBoss,
        });
        const bossMeta = isBoss ? mods.bossProfile : null;
        const bossPhase = bossMeta ? 1 : null;
        const bossSpeedMul = bossMeta ? bossMeta.speedByPhase[bossPhase - 1] ?? 1 : 1;
        const bossArmorBonus = bossMeta ? Math.floor((bossMeta.resistByPhase[bossPhase - 1] ?? 0) * 12) : 0;
        const affixHp = affix?.modifiers?.hpMul ?? 1;
        const affixSpeed = affix?.modifiers?.speedMul ?? 1;
        const affixArmor = affix?.modifiers?.armorFlat ?? 0;
        const affixLeak = affix?.modifiers?.leakDamageBonus ?? 0;
        const airPathPoints = wave.mainType === "AIR"
          ? getAirPathPoints(pathMap, spawn.routeId, activeDifficulty)
          : null;
        const creep = new Creep({
          id: creepId++,
          speed: baseSpeed * bossSpeedMul * affixSpeed,
          hp: Math.floor(baseHp * affixHp),
          armor: baseArmor + bossArmorBonus + affixArmor,
          waveType: wave.mainType,
          armorType: wave.armorType,
          pathMap,
          bus,
          spawnPointId: spawn.id,
          pathPoints: airPathPoints,
          leakDamage: mods.leakDamage + affixLeak,
          bossMeta,
          affix,
          specialEffects: mods.specialEffects,
        });
        creep.waveLevel = wave.id;
        creep.plannedDropItem = itemSystem.rollDrop(wave.id, {
          excludedUniqueSourceIds: getOwnedUniqueSourceIds(),
          difficulty: activeDifficulty,
        });
        creeps.push(creep);
      });

      applyCreepAurasToTowers();

      for (const creep of creeps) {
        creep.update(scaledDt);
      }

      for (const tower of towers) {
        syncTowerBlueprintRuntime(tower);
        tower.update(scaledDt, creeps);
      }

      autocastSystem.tick(towers, scaledDt);
      eliteAffixSystem.tick(creeps, scaledDt);
      portalLives = bossAbilitySystem.tick({ creeps, towers, dt: scaledDt, portalLives });

      if (waveSpawnFinished && creeps.length === 0) {
        const pendingLevels = Array.from(waveProgress.entries())
          .filter(([level, progress]) => {
            const unresolved = Math.max(0, (progress?.total ?? 0) - (progress?.killed ?? 0) - (progress?.leaked ?? 0));
            return unresolved <= 0 && !completedWaveLevels.has(level);
          })
          .map(([level]) => level)
          .sort((left, right) => left - right);

        let sagesseBatchGain = 0;
        if (pendingLevels.length > 0) {
          for (const level of pendingLevels) {
            completedWaveLevels.add(level);
            const completionMeta = metaSystem.completeWave(level);
            sagesseBatchGain += Math.max(0, Math.floor(completionMeta?.sagesseGain ?? 0));
          }
          syncMetaSnapshot();
          saveActiveProfileSnapshot();
          if (sagesseBatchGain > 0) {
            const label = pendingLevels.length > 1
              ? `${pendingLevels[0]}-${pendingLevels[pendingLevels.length - 1]}`
              : `${pendingLevels[0]}`;
            buildMessage = `Vagues ${label} terminées | +${sagesseBatchGain} sagesse`;
          }
        }

        if (!endlessMode && currentWaveLevel >= targetWave) {
          score += scoreBonus(500);
          if (!runResolved) {
            runResolved = true;
            const runMeta = metaSystem.applyRunResult({
              won: true,
              wave: currentWaveLevel,
              kills: totalKills,
              score,
            });
            if ((runMeta?.levelsGained ?? 0) > 0) {
              metaSystem.grantSagesse(runMeta.levelsGained);
            }
            syncMetaSnapshot();
            const unlocksBefore = getModeUnlocks();
            saveActiveProfileSnapshot();
            const unlocksAfter = getModeUnlocks();
            const unlockedMessages = [];
            if (!unlocksBefore.tripleUnlocked && unlocksAfter.tripleUnlocked) {
              unlockedMessages.push('Bravo cette victoire vous permet de jouer le mode "Triple" dorénavant');
            }
            if (!unlocksBefore.soloUnlocked && unlocksAfter.soloUnlocked) {
              unlockedMessages.push('Bravo cette victoire vous permet de jouer le mode "Solo" dorénavant');
            }
            if (!unlocksBefore.extremeUnlocked && unlocksAfter.extremeUnlocked) {
              unlockedMessages.push('Bravo cette victoire vous permet de jouer le mode "Extreme" dorénavant');
            }
            buildMessage = unlockedMessages.length > 0
              ? `Victoire atteinte a la vague ${currentWaveLevel} | ${unlockedMessages.join(" | ")}`
              : `Victoire atteinte a la vague ${currentWaveLevel}`;
          }
          awaitingVictoryChoice = true;
          victory = true;
          gamePaused = true;
          showRunOverlay(
            "victory",
            `Vague ${currentWaveLevel} | Kills ${totalKills} | Score ${score} | Or ${gold}`,
            { showContinueChoice: true },
          );
          buildMessage = `Victoire atteinte a la vague ${currentWaveLevel}.`;
          setTopMainLine();
          applyControlsUi();
          return;
        }

        if (autoWave) {
          currentWaveLevel += 1;
          startWave(currentWaveLevel);
        }
      }

      refreshRuntimeUi();
      if (tick % 120 === 0) {
        saveActiveProfileSnapshot();
      }
    },
    render: () => {
      renderScene(
        ctx,
        pathMap,
        spawnPoints,
        buildPads,
        selectedPadId,
        hoveredPadId,
        hoveredWorldPos,
        selectedTowerType,
        TOWER_BLUEPRINTS,
        getTowerPurchaseCost,
        gold,
        towers,
        creeps,
      );
    },
  });

  setTopMainLine();
  showMenuShell();
  loop.start();
}

function renderScene(
  ctx,
  pathMap,
  spawnPoints,
  buildPads,
  selectedPadId,
  hoveredPadId,
  hoveredWorldPos,
  selectedTowerType,
  towerBlueprints,
  getTowerPurchaseCost,
  gold,
  towers,
  creeps,
) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#122030";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawGrid(ctx, GRID_SIZE);
  drawPaths(ctx, pathMap.getAllRoutePoints());
  drawSpawnPoints(ctx, pathMap, spawnPoints);
  drawBuildPads(
    ctx,
    buildPads,
    selectedPadId,
    hoveredPadId,
    hoveredWorldPos,
    selectedTowerType,
    towerBlueprints,
    getTowerPurchaseCost,
    gold,
  );
  drawTowers(ctx, towers);

  for (const creep of creeps) {
    drawCreep(ctx, creep);
  }
}

function drawGrid(ctx, size) {
  ctx.save();
  ctx.strokeStyle = "rgba(142, 164, 191, 0.08)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= WIDTH; x += size) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }

  for (let y = 0; y <= HEIGHT; y += size) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPaths(ctx, routes) {
  const colors = ["#4ec9b0", "#f5a97f", "#89b4fa"];
  routes.forEach((points, idx) => {
    drawPath(ctx, points, colors[idx % colors.length]);
  });
}

function drawPath(ctx, points, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 24;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(15, 23, 32, 0.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawSpawnPoints(ctx, pathMap, spawnPoints) {
  for (const spawn of spawnPoints) {
    const route = pathMap.getRoute(spawn.routeId) ?? [];
    const nextPoint = route[1] ?? null;
    const angle = nextPoint ? Math.atan2(nextPoint.y - spawn.y, nextPoint.x - spawn.x) : 0;

    ctx.save();
    ctx.translate(spawn.x, spawn.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(-12, -7);
    ctx.lineTo(2, -7);
    ctx.lineTo(2, -12);
    ctx.lineTo(14, 0);
    ctx.lineTo(2, 12);
    ctx.lineTo(2, 7);
    ctx.lineTo(-12, 7);
    ctx.closePath();
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.strokeStyle = "#4a3f1f";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawBuildPads(
  ctx,
  pads,
  selectedPadId,
  hoveredPadId,
  hoveredWorldPos,
  selectedTowerType,
  towerBlueprints,
  getTowerPurchaseCost,
  gold,
) {
  const hoveredPad = hoveredPadId ? pads.find((pad) => pad.id === hoveredPadId) ?? null : null;
  const previewBlueprint = selectedTowerType ? towerBlueprints[selectedTowerType] ?? null : null;
  const resolveAuraPads = (anchorPad) => {
    if (!anchorPad) {
      return null;
    }
    const getPadByGrid = (col, row) => pads.find((pad) => pad.col === col && pad.row === row) ?? null;
    const candidates = [
      { col: anchorPad.col, row: anchorPad.row },
      { col: anchorPad.col - 1, row: anchorPad.row },
      { col: anchorPad.col, row: anchorPad.row - 1 },
      { col: anchorPad.col - 1, row: anchorPad.row - 1 },
    ];
    for (const candidate of candidates) {
      const footprintPads = [
        getPadByGrid(candidate.col, candidate.row),
        getPadByGrid(candidate.col + 1, candidate.row),
        getPadByGrid(candidate.col, candidate.row + 1),
        getPadByGrid(candidate.col + 1, candidate.row + 1),
      ];
      if (footprintPads.some((pad) => !pad || !!pad.towerId)) {
        continue;
      }
      return footprintPads;
    }
    return null;
  };
  const previewPads = previewBlueprint?.isAuraTower
    ? resolveAuraPads(hoveredPad)
    : (hoveredPad && !hoveredPad.towerId ? [hoveredPad] : null);
  const canAffordPreview = previewBlueprint ? gold >= (previewBlueprint.cost ?? 0) : false;

  if (previewPads && previewBlueprint) {
    const previewColor = previewBlueprint.color ?? "#93c5fd";
    const previewCenter = {
      x: previewPads.reduce((sum, pad) => sum + pad.x, 0) / previewPads.length,
      y: previewPads.reduce((sum, pad) => sum + pad.y, 0) / previewPads.length,
    };
    ctx.save();
    ctx.beginPath();
    ctx.arc(previewCenter.x, previewCenter.y, previewBlueprint.range, 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(previewColor, canAffordPreview ? 0.16 : 0.09);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(previewColor, canAffordPreview ? 0.78 : 0.45);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (hoveredWorldPos) {
      const label = `${previewBlueprint.label} - ${getTowerPurchaseCost(selectedTowerType)} or`;
      ctx.font = "12px Segoe UI";
      const textWidth = ctx.measureText(label).width;
      const labelX = Math.min(WIDTH - textWidth - 18, hoveredWorldPos.x + 14);
      const labelY = Math.max(20, hoveredWorldPos.y - 14);
      ctx.fillStyle = colorWithAlpha(previewColor, canAffordPreview ? 0.28 : 0.18);
      ctx.fillRect(labelX - 6, labelY - 14, textWidth + 12, 20);
      ctx.fillStyle = colorWithAlpha(previewColor, canAffordPreview ? 1 : 0.75);
      ctx.fillText(label, labelX, labelY);
    }
    ctx.restore();
  }

  for (const pad of pads) {
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, BUILD_PAD_RADIUS, 0, Math.PI * 2);
    const isSelected = selectedPadId === pad.id;
    const isHoveredPreview = !!previewPads?.some((entry) => entry.id === pad.id);
    const previewColor = previewBlueprint?.color ?? "#93c5fd";
    ctx.fillStyle = pad.towerId
      ? isSelected
        ? "rgba(110, 231, 183, 0.18)"
        : "rgba(110, 231, 183, 0.08)"
      : isHoveredPreview
        ? colorWithAlpha(previewColor, canAffordPreview ? 0.3 : 0.16)
      : isSelected
        ? "rgba(250, 204, 21, 0.16)"
        : "rgba(255, 255, 255, 0.03)";
    ctx.fill();
    ctx.strokeStyle = pad.towerId
      ? "rgba(110, 231, 183, 0.45)"
      : isHoveredPreview
        ? colorWithAlpha(previewColor, canAffordPreview ? 0.98 : 0.65)
      : isSelected
        ? "rgba(250, 204, 21, 0.65)"
        : "rgba(142, 164, 191, 0.18)";
    ctx.lineWidth = isHoveredPreview ? 2 : 1;
    ctx.stroke();
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawTowers(ctx, towers) {
  for (const tower of towers) {
    const isAtCap = tower.level >= tower.maxLevel;
    const hasLevel10Aura = tower.hasReachedBonusLevel?.() ?? tower.level >= 10;
    const towerRadius = isAtCap ? 19 : 16;
    const hasAuraHalo = tower.isAuraTower;
    if (hasAuraHalo) {
      const haloRadius = tower.isAuraTower ? GRID_SIZE + 6 : towerRadius + 8;
      ctx.beginPath();
      ctx.arc(tower.position.x, tower.position.y, haloRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(254, 240, 138, 0.82)";
      ctx.lineWidth = tower.isAuraTower ? 4 : 3;
      ctx.stroke();
    }
    if (tower.isAuraTower) {
      const size = GRID_SIZE * 2 - 8;
      drawRoundedRect(ctx, tower.position.x - size / 2, tower.position.y - size / 2, size, size, 12);
      ctx.fillStyle = tower.color;
      ctx.fill();
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(tower.position.x, tower.position.y, towerRadius, 0, Math.PI * 2);
      ctx.fillStyle = tower.color;
      ctx.fill();
      ctx.strokeStyle = hasLevel10Aura ? "#facc15" : "#1d4ed8";
      ctx.lineWidth = hasLevel10Aura ? 4 : 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(tower.position.x, tower.position.y, tower.range, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(147, 197, 253, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = tower.isAuraTower ? "#111827" : "#f8fafc";
    ctx.font = isAtCap ? "bold 14px Segoe UI" : "bold 12px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isAtCap ? "X" : String(tower.level), tower.position.x, tower.position.y);
  }
}

function drawCreep(ctx, creep) {
  const isBoss = !!creep.bossMeta;
  const affixTint = creep.affix?.tint ?? null;
  const radius = isBoss ? 14 : 10;
  const isAir = String(creep.waveType ?? "").toUpperCase() === "AIR";
  const isInvisible = !!creep.isInvisible && !(creep.isRevealed?.());

  ctx.save();
  ctx.globalAlpha = isInvisible ? 0.32 : 1;

  if (creep.auraAffected) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, radius + 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(254, 240, 138, 0.82)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  if (creep.iceSlowTimer > 0) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (creep.poisonSlowTimer > 0) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, radius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(22, 101, 52, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (creep.burnStacks > 0) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if ((creep.stunTimer ?? 0) > 0) {
    const blinkOn = Math.floor(performance.now() / 140) % 2 === 0;
    if (blinkOn) {
      ctx.beginPath();
      ctx.arc(creep.position.x, creep.position.y, radius + 10, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(139, 90, 43, 0.95)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  if ((creep.shieldHp ?? 0) > 0) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, radius + 12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 228, 181, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (creep.hasSlowAura && (creep.slowAuraRadius ?? 0) > 0) {
    ctx.beginPath();
    ctx.arc(creep.position.x, creep.position.y, creep.slowAuraRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(187, 128, 128, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  if (isAir) {
    ctx.moveTo(creep.position.x, creep.position.y - radius);
    ctx.lineTo(creep.position.x + radius, creep.position.y);
    ctx.lineTo(creep.position.x, creep.position.y + radius);
    ctx.lineTo(creep.position.x - radius, creep.position.y);
    ctx.closePath();
  } else {
    ctx.arc(creep.position.x, creep.position.y, radius, 0, Math.PI * 2);
  }
  if (isBoss) {
    const bossColor =
      creep.bossPhase >= 3 ? "#ef4444" : creep.bossPhase === 2 ? "#f97316" : "#fb7185";
    ctx.fillStyle = bossColor;
  } else {
    ctx.fillStyle = affixTint ?? "#ff6b6b";
  }
  ctx.fill();
  ctx.strokeStyle = isBoss ? "#fff1f2" : affixTint ? "#fff7ed" : "#ffe4e4";
  ctx.lineWidth = isBoss ? 2 : 1.5;
  ctx.stroke();
  ctx.restore();

  const hpRatio = creep.maxHp > 0 ? Math.max(0, Math.min(1, creep.currentHp / creep.maxHp)) : 0;
  const barWidth = isBoss ? 34 : 24;
  const barX = creep.position.x - barWidth / 2;
  const barY = creep.position.y - radius - 10;

  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(barX, barY, barWidth, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#22c55e" : "#ef4444";
  ctx.fillRect(barX, barY, barWidth * hpRatio, 4);
}

boot();
