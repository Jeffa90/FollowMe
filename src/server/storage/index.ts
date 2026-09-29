// Storage abstraction: local disk (dev), S3-compatible (MinIO/S3), optional AES-256-GCM encryption at rest.
// Azure Blob adapter: design only (docs/02-architecture/deployment.md); intentionally not implemented in MVP.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class LocalStore implements BlobStore {
  constructor(private root: string) {}
  private p(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.p(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data, { flag: "wx" }).catch((e) => {
      if (e.code !== "EEXIST") throw e; // content-addressed: identical key already holds identical bytes
    });
  }
  async get(key: string) {
    return fs.readFile(this.p(key));
  }
  async exists(key: string) {
    return fs.access(this.p(key)).then(() => true, () => false);
  }
  async delete(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
}

export class S3Store implements BlobStore {
  private client: import("@aws-sdk/client-s3").S3Client | null = null;
  constructor(private bucket: string, private opts: { endpoint?: string; region: string; accessKey?: string; secretKey?: string }) {}
  private async c() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({
        region: this.opts.region,
        endpoint: this.opts.endpoint,
        forcePathStyle: true,
        credentials: this.opts.accessKey ? { accessKeyId: this.opts.accessKey, secretAccessKey: this.opts.secretKey! } : undefined,
      });
    }
    return this.client;
  }
  async put(key: string, data: Buffer) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.c()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await this.c()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.c()).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async exists(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    return (await this.c()).send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })).then(() => true, () => false);
  }
}

/** Envelope: 1 byte version | 12 byte IV | 16 byte tag | ciphertext. */
export class EncryptedStore implements BlobStore {
  constructor(private inner: BlobStore, private key: Buffer) {
    if (key.length !== 32) throw new Error("ASSET_ENCRYPTION_KEY must decode to 32 bytes");
  }
  async put(k: string, data: Buffer) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    await this.inner.put(k, Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), enc]));
  }
  async get(k: string) {
    const raw = await this.inner.get(k);
    if (raw[0] !== 1) throw new Error("Unknown blob envelope version");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(1, 13));
    d.setAuthTag(raw.subarray(13, 29));
    return Buffer.concat([d.update(raw.subarray(29)), d.final()]);
  }
  exists(k: string) {
    return this.inner.exists(k);
  }
  delete(k: string) {
    return this.inner.delete(k);
  }
}

let store: BlobStore | undefined;
export function blobStore(): BlobStore {
  if (!store) {
    const e = env();
    let inner: BlobStore;
    if (e.STORAGE_DRIVER === "s3") {
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET required for STORAGE_DRIVER=s3");
      inner = new S3Store(e.S3_BUCKET, { endpoint: e.S3_ENDPOINT, region: e.S3_REGION, accessKey: e.S3_ACCESS_KEY, secretKey: e.S3_SECRET_KEY });
    } else inner = new LocalStore(path.resolve(e.STORAGE_LOCAL_DIR));
    store = e.ASSET_ENCRYPTION_KEY ? new EncryptedStore(inner, Buffer.from(e.ASSET_ENCRYPTION_KEY, "base64")) : inner;
  }
  return store;
}
export function setBlobStoreForTests(s: BlobStore | undefined) {
  store = s;
}
