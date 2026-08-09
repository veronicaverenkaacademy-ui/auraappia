/**
 * Geração e verificação de código OTP — usa só Web Crypto (crypto.getRandomValues /
 * crypto.subtle), disponível nativamente tanto no runtime de produção (Cloudflare
 * Workers) quanto no Node local, sem depender de node:crypto (scrypt/bcrypt não são
 * garantidos no Workers). PBKDF2-SHA256 com iteração alta é apropriado para um
 * segredo de baixa entropia como um código de 6 dígitos — um hash rápido (SHA-256
 * puro) permitiria testar todas as ~1 milhão de combinações quase instantaneamente
 * se o banco vazasse.
 */

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Código numérico de 6 dígitos, com zero à esquerda quando necessário. */
export function generateOtpCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const n = bytes[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

async function pbkdf2(code: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
}

/** Formato auto-descritivo: pbkdf2$<iterações>$<salt hex>$<hash hex>. */
export async function hashOtpCode(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(code, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${toHex(hash)}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyOtpCode(code: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]);
  const expectedHex = parts[3];
  if (!Number.isFinite(iterations) || salt.length === 0) return false;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return timingSafeEqual(toHex(hash), expectedHex);
}

/** Senha temporária aleatória para a "sessão emprestada" — 256 bits, nunca logada. */
export function generateRandomPassword(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
