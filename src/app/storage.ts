// 存储适配器。接口是异步的，方便以后换成原生桥；默认实现在调用当下就同步写入 localStorage。

export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 进行中的存档（serializeSave 的结果）。 */
export const SAVE_KEY = "liuxue.save.v1";
/** 留学人生图鉴，跨局累计，不随重开清空。 */
export const GALLERY_KEY = "liuxue.gallery.v1";

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
