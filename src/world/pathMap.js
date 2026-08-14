export class PathMap {
  constructor(config) {
    this.routes = new Map();
    this.spawnPoints = [];

    // Backward compatibility: new PathMap([{x,y}, ...])
    if (Array.isArray(config) && config.length >= 2) {
      const routePoints = config.map((p) => ({ x: p.x, y: p.y }));
      this.routes.set("main", routePoints);
      this.spawnPoints = [
        {
          id: "spawn-main",
          routeId: "main",
          x: routePoints[0].x,
          y: routePoints[0].y,
        },
      ];
      return;
    }

    if (!config || !Array.isArray(config.routes) || config.routes.length === 0) {
      throw new Error("PathMap requires at least one route.");
    }

    for (const route of config.routes) {
      if (!route?.id || !Array.isArray(route.points) || route.points.length < 2) {
        throw new Error("Each route requires an id and at least 2 points.");
      }
      this.routes.set(
        route.id,
        route.points.map((p) => ({ x: p.x, y: p.y })),
      );
    }

    if (!Array.isArray(config.spawnPoints) || config.spawnPoints.length === 0) {
      throw new Error("PathMap requires at least one spawn point.");
    }

    this.spawnPoints = config.spawnPoints.map((spawn) => {
      if (!spawn?.id || !spawn?.routeId) {
        throw new Error("Spawn point requires id and routeId.");
      }

      const route = this.routes.get(spawn.routeId);
      if (!route) {
        throw new Error(`Spawn point ${spawn.id} references unknown route ${spawn.routeId}.`);
      }

      return {
        id: spawn.id,
        routeId: spawn.routeId,
        x: spawn.x ?? route[0].x,
        y: spawn.y ?? route[0].y,
      };
    });
  }

  getSpawnPoints() {
    return [...this.spawnPoints];
  }

  getSpawnPoint(spawnId) {
    return this.spawnPoints.find((s) => s.id === spawnId) ?? null;
  }

  getRoute(routeId) {
    return this.routes.get(routeId) ?? null;
  }

  getPointAtRatio(routeId, ratio) {
    const route = this.routes.get(routeId) ?? null;
    if (!route || route.length === 0) {
      return null;
    }
    if (route.length === 1) {
      return { ...route[0] };
    }

    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    if (clampedRatio <= 0) {
      return { ...route[0] };
    }
    if (clampedRatio >= 1) {
      return { ...route[route.length - 1] };
    }

    let totalLength = 0;
    const segments = [];
    for (let i = 0; i < route.length - 1; i += 1) {
      const start = route[i];
      const end = route[i + 1];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      segments.push({ start, end, length });
      totalLength += length;
    }

    if (totalLength <= 0) {
      return { ...route[0] };
    }

    const targetLength = totalLength * clampedRatio;
    let traveled = 0;
    for (const segment of segments) {
      if (traveled + segment.length >= targetLength) {
        const segmentRatio = (targetLength - traveled) / segment.length;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * segmentRatio,
          y: segment.start.y + (segment.end.y - segment.start.y) * segmentRatio,
        };
      }
      traveled += segment.length;
    }

    return { ...route[route.length - 1] };
  }

  getNextPoint(routeId, index) {
    return this.routes.get(routeId)?.[index + 1] ?? null;
  }

  getAllRoutePoints() {
    return Array.from(this.routes.values());
  }
}
