export class DocumentationLoader {
  async loadFromPublicPath(path) {
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(`Failed to load documentation from ${path} (${response.status}).`);
    }

    return response.text();
  }
}
