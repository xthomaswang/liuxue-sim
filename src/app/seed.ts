// 新一局的 seed 与 runId，以及界面上“随机分配”用的随机数。
// 这是全项目唯一允许使用系统随机源的地方；规则本身只用 seed 派生的确定值。

export const MAX_SEED = 4294967295;

export function newSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] >>> 0;
}

export function newRunId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** [0, bound) 内的随机整数。只给界面的便利功能用，不参与任何规则。 */
export function randomInt(bound: number): number {
  return newSeed() % bound;
}

/** 把玩家输入解析成 0–4294967295 的整数；不合法返回 null。 */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : null;
}
