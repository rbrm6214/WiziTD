export class SeededRandom {
  constructor(seed = 123456789) {
    this.state = seed >>> 0;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick(array) {
    if (!Array.isArray(array) || array.length === 0) {
      throw new Error("Cannot pick from an empty array.");
    }

    const index = this.int(0, array.length - 1);
    return array[index];
  }
}
