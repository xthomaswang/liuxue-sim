// 存储适配器。接口是异步的，方便以后换成原生桥；默认实现在调用当下就同步写入 localStorage。

export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 当前这一局（serializeSave 的结果）。 */
export const SAVE_KEY = "liuxue.save.v1";
/** 当前这一局已经显示到哪里（人生轨迹的段数、是否看过总结）。 */
export const REVEAL_KEY = "liuxue.reveal.v1";
/** 跨局进度：结局图鉴、成就、已解锁的天赋、继承的天赋。 */
export const PROGRESS_KEY = "liuxue.progress.v2";
/** 旧版图鉴，只在首次读取跨局进度时并入。 */
export const LEGACY_GALLERY_KEY = "liuxue.gallery.v1";

export function createLocalStorage(): SaveStorage {
  return {
    async read(key) {
      return window.localStorage.getItem(key);
    },
    async write(key, value) {
      window.localStorage.setItem(key, value);
    },
    async remove(key) {
      window.localStorage.removeItem(key);
    },
  };
}

/** 内存实现：测试用，也可在本机存储不可用时临时顶替。 */
export function createMemoryStorage(initial: Record<string, string> = {}): SaveStorage & { dump(): Record<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    async read(key) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    async write(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}
