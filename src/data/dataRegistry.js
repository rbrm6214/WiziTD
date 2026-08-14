export class DataRegistry {
  constructor() {
    this.buckets = new Map();
  }

  registerMany(bucketName, entries, keyField = "id") {
    if (!this.buckets.has(bucketName)) {
      this.buckets.set(bucketName, new Map());
    }

    const bucket = this.buckets.get(bucketName);
    for (const entry of entries) {
      const key = entry[keyField];
      if (key === undefined || key === null) {
        throw new Error(`Entry in bucket '${bucketName}' is missing key '${keyField}'.`);
      }
      bucket.set(key, entry);
    }
  }

  get(bucketName, id) {
    return this.buckets.get(bucketName)?.get(id) ?? null;
  }

  count(bucketName) {
    return this.buckets.get(bucketName)?.size ?? 0;
  }

  getBucketNames() {
    return Array.from(this.buckets.keys());
  }
}
