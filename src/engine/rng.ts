// 可复现随机源（docs/06 第 1 节）。不是密码学用途；规则里禁止使用 Math.random。

export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** [0, 1) 内的确定值；同一 seed 与 key 永远相同，互不影响其它 key。 */
export function draw01(seed: number, key: string): number {
  return hash32(`${seed >>> 0}:${key}`) / 4294967296;
}

export function pickIndex(seed: number, key: string, length: number): number {
  if (length <= 0) throw new Error("EMPTY_POOL");
  return Math.floor(draw01(seed, key) * length);
}
