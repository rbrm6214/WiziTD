export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }

    const set = this.listeners.get(eventName);
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  emit(eventName, payload = {}) {
    const handlers = this.listeners.get(eventName);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(payload);
    }
  }
}
