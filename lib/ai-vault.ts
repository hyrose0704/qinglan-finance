export const AI_VAULT_KEY = "qinglan-deepseek-key-v1";
const ITERATIONS = 250_000;
const AAD = new TextEncoder().encode("qinglan:deepseek:v1");

export interface EncryptedApiKey {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

export function normalizeApiKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error("请输入完整的 DeepSeek API Key，且不要包含空格或换行。");
  }
  return key;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export function readEncryptedApiKey(value: unknown): EncryptedApiKey {
  if (!value || typeof value !== "object") throw new Error("本地 Key 记录无效，请重新连接。");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.salt !== "string" || typeof v.iv !== "string" || typeof v.ciphertext !== "string") {
    throw new Error("本地 Key 记录无效，请重新连接。");
  }
  if (decode(v.salt).length !== 16 || decode(v.iv).length !== 12 || decode(v.ciphertext).length < 24) {
    throw new Error("本地 Key 记录无效，请重新连接。");
  }
  return { version: 1, salt: v.salt, iv: v.iv, ciphertext: v.ciphertext };
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (password.length < 8 || password.length > 128) throw new Error("本地解锁密码需要8至128个字符。");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptApiKey(value: string, password: string): Promise<EncryptedApiKey> {
  const key = normalizeApiKey(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derived = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, derived,
    new TextEncoder().encode(key));
  return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function decryptApiKey(value: EncryptedApiKey, password: string): Promise<string> {
  try {
    const record = readEncryptedApiKey(value);
    const key = await deriveKey(password, decode(record.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(record.iv), additionalData: AAD }, key,
      decode(record.ciphertext));
    return normalizeApiKey(new TextDecoder().decode(plain));
  } catch {
    throw new Error("无法解锁：密码不正确或保存内容已损坏。");
  }
}
