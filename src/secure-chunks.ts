/**
 * Splits values across several secure-storage entries so that no single entry exceeds a conservative size.
 * Expo SecureStore does not enforce a limit, but platforms have historically rejected values above ~2048 bytes,
 * and Supabase sessions with provider metadata can exceed that.
 *
 * Writes are crash-safe: chunks are written under a fresh generation id and the manifest entry (stored at the
 * original key) is replaced last, so an interrupted write leaves the previous value readable.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MANIFEST = /^dfchunks:v1:([A-Za-z0-9]+):(\d{1,4})$/;
export const MAX_CHUNK_BYTES = 1800;

function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** Splits on code-point boundaries so that each chunk is at most maxBytes when UTF-8 encoded. */
export function splitByBytes(value: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of value) {
    const size = utf8Length(ch.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes && current) { chunks.push(current); current = ''; bytes = 0; }
    current += ch;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

const chunkKey = (key: string, generation: string, index: number) => `${key}.${generation}.${index}`;

export function createChunkedStorage(store: KeyValueStore, newGeneration: () => string, maxBytes = MAX_CHUNK_BYTES) {
  async function readManifest(key: string) {
    const raw = await store.getItem(key);
    if (raw === null) return { raw: null, manifest: null };
    const match = MANIFEST.exec(raw);
    return { raw, manifest: match ? { generation: match[1], count: Number(match[2]) } : null };
  }
  async function removeChunks(key: string, generation: string, count: number) {
    await Promise.all(Array.from({ length: count }, (_, i) => store.removeItem(chunkKey(key, generation, i)).catch(() => undefined)));
  }
  return {
    async getItem(key: string): Promise<string | null> {
      const { raw, manifest } = await readManifest(key);
      if (raw === null) return null;
      // Values written before chunking was introduced are returned unchanged.
      if (!manifest) return raw;
      const parts = await Promise.all(Array.from({ length: manifest.count }, (_, i) => store.getItem(chunkKey(key, manifest.generation, i))));
      // A missing chunk means the value cannot be trusted; treat it as absent rather than returning a fragment.
      return parts.some(part => part === null) ? null : parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      const previous = await readManifest(key).catch(() => ({ raw: null, manifest: null }));
      const generation = newGeneration().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
      if (!generation) throw new Error('Secure storage generation id is empty.');
      const parts = splitByBytes(value, maxBytes);
      try {
        for (let i = 0; i < parts.length; i++) await store.setItem(chunkKey(key, generation, i), parts[i]);
        await store.setItem(key, `dfchunks:v1:${generation}:${parts.length}`);
      } catch (error) {
        await removeChunks(key, generation, parts.length);
        throw error;
      }
      if (previous.manifest && previous.manifest.generation !== generation) {
        await removeChunks(key, previous.manifest.generation, previous.manifest.count);
      }
    },
    async removeItem(key: string): Promise<void> {
      const { manifest } = await readManifest(key).catch(() => ({ manifest: null }));
      await store.removeItem(key);
      if (manifest) await removeChunks(key, manifest.generation, manifest.count);
    },
  };
}
