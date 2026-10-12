// 游戏状态仓库：读档、把操作交给引擎、每次有效操作后写档、记图鉴。
// 规则全部在 src/engine；这里不计算任何数值，只负责把结果存住。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CATALOG } from "../content";
import { applyAction, checkCatalog, createRun, loadSave, serializeSave } from "../engine";
import type { Action, ActionResult, EngineError, OfferTier, RunState, RuntimeCatalog } from "../engine";
import { emptyGallery, parseGallery, recordEnding } from "./gallery";
import type { GalleryState } from "./gallery";
import { newRunId, newSeed } from "./seed";
import { GALLERY_KEY, SAVE_KEY, createLocalStorage } from "./storage";
import type { SaveStorage } from "./storage";

export type BootStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "catalog-problem"; counts: Record<OfferTier, number>; message: string }
  | { kind: "save-problem"; reason: "CORRUPT" | "VERSION_MISMATCH"; detail: string }
  | { kind: "fatal"; message: string };

export type SaveStatus = "saved" | "unsaved";

export interface DispatchResult {
  ok: boolean;
  error: EngineError | null;
}

export interface GameStore {
  boot: BootStatus;
  /** boot 为 ready 时一定非空。 */
  state: RunState | null;
  catalog: RuntimeCatalog;
  saveStatus: SaveStatus;
  gallery: GalleryState;
  /** 最近一次被引擎拒绝的操作；下一次成功操作后清空。 */
  rejected: EngineError | null;
  dispatch(action: Action): DispatchResult;
  /** 开新局并覆盖存档。不传 seed 则生成新的。 */
  restart(seed?: number): void;
}

interface Snapshot {
  state: RunState;
  log: Action[];
}

const GameContext = createContext<GameStore | null>(null);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GameProvider(props: { catalog?: RuntimeCatalog; storage?: SaveStorage; children: ReactNode }) {
  const catalog = props.catalog ?? CATALOG;
  const storage = useMemo(() => props.storage ?? createLocalStorage(), [props.storage]);
  const context = useMemo(() => ({ catalog }), [catalog]);

  const [boot, setBoot] = useState<BootStatus>({ kind: "loading" });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [gallery, setGallery] = useState<GalleryState>(emptyGallery);
  const [rejected, setRejected] = useState<EngineError | null>(null);

  // live 是“已经结算到哪一步”的唯一事实；React 状态只是它的投影。
  const live = useRef<Snapshot | null>(null);
  const galleryRef = useRef<GalleryState>(gallery);
  const writeSequence = useRef(0);

  const persist = useCallback(
    (next: Snapshot) => {
      const sequence = ++writeSequence.current;
      const settle = (status: SaveStatus) => {
        if (sequence === writeSequence.current) setSaveStatus(status);
      };
      try {
        // localStorage 实现会在这一行同步写完；Promise 只用来汇报成败。
        storage.write(SAVE_KEY, serializeSave(next.state, next.log)).then(
          () => settle("saved"),
          () => settle("unsaved"),
        );
      } catch {
        settle("unsaved");
      }
    },
    [storage],
  );

  const commit = useCallback(
    (next: Snapshot) => {
      live.current = next;
      setSnapshot(next);
      setRejected(null);
      persist(next);
    },
    [persist],
  );

  const startNew = useCallback(
    (seed?: number) => {
      try {
        const state = createRun({ seed: seed ?? newSeed(), runId: newRunId(), catalog });
        commit({ state, log: [] });
        setBoot({ kind: "ready" });
      } catch (error) {
        setBoot({ kind: "fatal", message: describe(error) });
      }
    },
    [catalog, commit],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const check = checkCatalog(catalog);
        if (!check.ok) {
          setBoot({ kind: "catalog-problem", counts: check.counts, message: check.message });
          return;
        }

        let galleryText: string | null = null;
        try {
          galleryText = await storage.read(GALLERY_KEY);
        } catch {
          galleryText = null;
        }
        if (cancelled) return;
        const loadedGallery = parseGallery(galleryText);
        galleryRef.current = loadedGallery;
        setGallery(loadedGallery);

        let saveText: string | null = null;
        try {
          saveText = await storage.read(SAVE_KEY);
        } catch {
          // 读不到本机存储：照常开新局，随后的写入失败会把状态标成“未保存”。
          saveText = null;
        }
        if (cancelled) return;

        if (saveText === null) {
          startNew();
          return;
        }
        const loaded = loadSave(saveText, context);
        if (!loaded.ok) {
          setBoot({ kind: "save-problem", reason: loaded.reason, detail: loaded.detail });
          return;
        }
        const restored: Snapshot = { state: loaded.state, log: loaded.log };
        live.current = restored;
        setSnapshot(restored);
        setSaveStatus("saved");
        setBoot({ kind: "ready" });
      } catch (error) {
        if (!cancelled) setBoot({ kind: "fatal", message: describe(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, context, storage, startNew]);

  // 操作带上“界面渲染时看到的 revision”。连点时第二次仍是旧值，引擎按 STALE_REVISION 拒绝。
  const renderedRevision = snapshot?.state.revision;
  const dispatch = useCallback(
    (action: Action): DispatchResult => {
      const current = live.current;
      if (!current || renderedRevision === undefined) {
        return { ok: false, error: { code: "INVALID_ACTION", message: "游戏尚未就绪。" } };
      }
      let result: ActionResult;
      try {
        result = applyAction(current.state, { ...action, revision: renderedRevision }, context);
      } catch (error) {
        const message = describe(error);
        setBoot({ kind: "fatal", message });
        return { ok: false, error: { code: "INVALID_ACTION", message } };
      }
      if (!result.ok) {
        setRejected(result.error);
        return { ok: false, error: result.error };
      }
      commit({ state: result.state, log: [...current.log, action] });
      return { ok: true, error: null };
    },
    [commit, context, renderedRevision],
  );

  const restart = useCallback((seed?: number) => startNew(seed), [startNew]);

  // 到达结局时把结局卡记入图鉴；按 runId 幂等，刷新或回看不会重复计数。
  const current = snapshot?.state ?? null;
  useEffect(() => {
    if (boot.kind !== "ready" || !current || current.phase === "SETUP") return;
    if (current.phase !== "ENDING" || !current.ending) return;
    const before = galleryRef.current;
    const after = recordEnding(before, {
      runId: current.runId,
      seed: current.seed,
      card: current.ending.card,
      at: new Date().toISOString(),
    });
    if (after === before) return;
    galleryRef.current = after;
    setGallery(after);
    try {
      storage.write(GALLERY_KEY, JSON.stringify(after)).catch(() => undefined);
    } catch {
      // 图鉴写不进去不影响这一局。
    }
  }, [boot.kind, current, storage]);

  const store = useMemo<GameStore>(
    () => ({ boot, state: current, catalog, saveStatus, gallery, rejected, dispatch, restart }),
    [boot, current, catalog, saveStatus, gallery, rejected, dispatch, restart],
  );

  return <GameContext.Provider value={store}>{props.children}</GameContext.Provider>;
}

export function useGame(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error("useGame 必须在 GameProvider 内使用");
  return store;
}
