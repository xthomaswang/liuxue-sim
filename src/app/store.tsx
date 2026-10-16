// 游戏状态仓库（第三版，docs/22）：玩家只选天赋和分点，确认分点时整局一次算完，之后界面分段显示。
// 这里负责：读档、开新局、调用引擎模拟、记住显示进度、一局结束时结算跨局进度。规则全部在 src/engine。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CATALOG, TALENTS } from "../content";
import { checkCatalog, createRun, evaluateRun, loadSave, serializeSave, simulate } from "../engine";
import type { Action, OfferTier, Points, RunRewards, RunState, RuntimeCatalog } from "../engine";
import { emptyProgress, migrateLegacyGallery, parseProgress, parseReveal, settleRun, snapshotOf } from "./progress";
import type { ProgressState, RevealState } from "./progress";
import { newRunId, newSeed } from "./seed";
import { LEGACY_GALLERY_KEY, PROGRESS_KEY, REVEAL_KEY, SAVE_KEY, createLocalStorage } from "./storage";
import type { SaveStorage } from "./storage";

export type BootStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "catalog-problem"; counts: Record<OfferTier, number>; message: string }
  | { kind: "save-problem"; reason: "CORRUPT" | "VERSION_MISMATCH"; detail: string }
  | { kind: "fatal"; message: string };

export type SaveStatus = "saved" | "unsaved";

/** 界面所处的屏。 */
export type Screen = "HOME" | "TALENTS" | "ALLOCATE" | "TIMELINE" | "SUMMARY";

export interface GameStore {
  boot: BootStatus;
  catalog: RuntimeCatalog;
  saveStatus: SaveStatus;
  screen: Screen;
  /** 存档里的这一局：还没开始模拟（SETUP）或已经算完（ENDING）；没有则 null。 */
  run: RunState | null;
  /** 天赋屏选好的几张，只在本次会话里保留。 */
  chosenTalents: string[];
  reveal: RevealState | null;
  progress: ProgressState;
  /** 当前这一局结算得到的收获；还没结算则 null。 */
  rewards: RunRewards | null;
  goHome(): void;
  /** 开新局（新 seed 或指定 seed），进入天赋屏。 */
  startRun(seed?: number): void;
  /** 回到存档里的这一局上次停下的地方。 */
  continueRun(): void;
  chooseTalents(ids: string[]): void;
  backToTalents(): void;
  /** 确认分点：整局在这里一次算完。 */
  beginLife(points: Points): void;
  /** 人生轨迹显示到第几段。 */
  revealTo(shown: number): void;
  /** 进入人生总结；第一次进入时结算跨局进度（按 runId 只做一次）。 */
  openSummary(): void;
  /** 选一张天赋下次还能抽到；传 null 取消。 */
  setInherit(id: string | null): void;
  /** 丢掉读不出来的存档，回到首页。 */
  discardSave(): void;
  /** 出错兜底页用：回到首页，不动存档。 */
  recover(): void;
}

interface Session {
  screen: Screen;
  run: { state: RunState; log: Action[] } | null;
  chosen: string[];
  reveal: RevealState | null;
  progress: ProgressState;
}

const GameContext = createContext<GameStore | null>(null);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TALENT_ORDER = new Map(TALENTS.map((talent, index) => [talent.id, index]));
/** 只保留天赋池里存在的 id，并按池内顺序排列。 */
function inPoolOrder(ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => TALENT_ORDER.has(id)).sort((a, b) => (TALENT_ORDER.get(a) ?? 0) - (TALENT_ORDER.get(b) ?? 0));
}

export function GameProvider(props: { catalog?: RuntimeCatalog; storage?: SaveStorage; children: ReactNode }) {
  const catalog = props.catalog ?? CATALOG;
  const storage = useMemo(() => props.storage ?? createLocalStorage(), [props.storage]);
  const context = useMemo(() => ({ catalog }), [catalog]);

  const [boot, setBoot] = useState<BootStatus>({ kind: "loading" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [session, setSession] = useState<Session>(() => ({
    screen: "HOME",
    run: null,
    chosen: [],
    reveal: null,
    progress: emptyProgress(),
  }));

  // live 是唯一事实；React 状态是它的投影。连点时第二次读到的已经是更新后的值。
  const live = useRef<Session>(session);
  const failedKeys = useRef(new Set<string>());
  const writeSequence = useRef(new Map<string, number>());

  const update = useCallback((patch: Partial<Session>) => {
    live.current = { ...live.current, ...patch };
    setSession(live.current);
  }, []);

  const write = useCallback(
    (key: string, value: string | null) => {
      const sequence = (writeSequence.current.get(key) ?? 0) + 1;
      writeSequence.current.set(key, sequence);
      const settle = (ok: boolean) => {
        if (writeSequence.current.get(key) !== sequence) return;
        if (ok) failedKeys.current.delete(key);
        else failedKeys.current.add(key);
        setSaveStatus(failedKeys.current.size === 0 ? "saved" : "unsaved");
      };
      try {
        // localStorage 实现会在这一行同步写完；Promise 只用来汇报成败。
        const pending = value === null ? storage.remove(key) : storage.write(key, value);
        pending.then(
          () => settle(true),
          () => settle(false),
        );
      } catch {
        settle(false);
      }
    },
    [storage],
  );

  const fail = useCallback((error: unknown) => setBoot({ kind: "fatal", message: describe(error) }), []);

  /** 结算这一局（幂等）并返回结算后的进度。 */
  const settled = useCallback((current: Session): ProgressState => {
    const state = current.run?.state;
    if (!state || state.phase === "SETUP" || !state.ending) return current.progress;
    if (current.progress.rewardedRuns.includes(state.runId)) return current.progress;
    const rewards = evaluateRun(state, snapshotOf(current.progress));
    return settleRun(current.progress, {
      runId: state.runId,
      seed: state.seed,
      card: state.ending.card,
      outcomeId: state.life?.outcome?.id ?? null,
      rewards,
      at: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const read = async (key: string): Promise<string | null> => {
      try {
        return await storage.read(key);
      } catch {
        // 读不到本机存储：按没有处理，随后的写入失败会把状态标成“未保存”。
        return null;
      }
    };
    void (async () => {
      try {
        const check = checkCatalog(catalog);
        if (!check.ok) {
          setBoot({ kind: "catalog-problem", counts: check.counts, message: check.message });
          return;
        }

        // 跨局进度：没有新格式时把旧图鉴并进来（只做这一次）。
        let progress = parseProgress(await read(PROGRESS_KEY));
        if (cancelled) return;
        if (!progress) {
          const legacy = await read(LEGACY_GALLERY_KEY);
          if (cancelled) return;
          progress = migrateLegacyGallery(legacy);
          if (legacy !== null) write(PROGRESS_KEY, JSON.stringify(progress));
        }

        const saveText = await read(SAVE_KEY);
        if (cancelled) return;
        if (saveText === null) {
          update({ screen: "HOME", run: null, chosen: [], reveal: null, progress });
          setBoot({ kind: "ready" });
          return;
        }
        const loaded = loadSave(saveText, context);
        if (!loaded.ok) {
          update({ screen: "HOME", run: null, chosen: [], reveal: null, progress });
          setBoot({ kind: "save-problem", reason: loaded.reason, detail: loaded.detail });
          return;
        }
        const state = loaded.state;
        if (state.phase !== "SETUP" && state.phase !== "ENDING") {
          update({ screen: "HOME", run: null, chosen: [], reveal: null, progress });
          setBoot({ kind: "save-problem", reason: "VERSION_MISMATCH", detail: `存档停在旧版本的中途阶段（${state.phase}）。` });
          return;
        }
        const reveal = parseReveal(await read(REVEAL_KEY), state.runId);
        if (cancelled) return;
        const restored: Session = { screen: "HOME", run: { state, log: loaded.log }, chosen: [], reveal, progress };
        if (state.phase === "ENDING") {
          if (reveal.summarySeen) {
            // 上次已经看到总结：确保结算做过（幂等），直接回到总结。
            restored.progress = settled(restored);
            restored.screen = "SUMMARY";
            if (restored.progress !== progress) write(PROGRESS_KEY, JSON.stringify(restored.progress));
          } else {
            restored.screen = "TIMELINE";
          }
        }
        update(restored);
        setBoot({ kind: "ready" });
      } catch (error) {
        if (!cancelled) fail(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, context, storage, update, write, fail, settled]);

  const goHome = useCallback(() => update({ screen: "HOME" }), [update]);

  const startRun = useCallback(
    (seed?: number) => {
      try {
        const progress = live.current.progress;
        const inherit = progress.inherit !== null && TALENT_ORDER.has(progress.inherit) ? progress.inherit : null;
        const state = createRun({
          seed: seed ?? newSeed(),
          runId: newRunId(),
          catalog,
          unlockedTalents: inPoolOrder(progress.unlockedTalents),
          inheritedTalent: inherit,
        });
        const reveal: RevealState = { runId: state.runId, shown: 0, summarySeen: false };
        // 继承的天赋用掉了：要再继承，得在下一局的总结页重新选。
        const nextProgress = progress.inherit === null ? progress : { ...progress, inherit: null };
        update({ screen: "TALENTS", run: { state, log: [] }, chosen: [], reveal, progress: nextProgress });
        setBoot({ kind: "ready" });
        write(SAVE_KEY, serializeSave(state, []));
        write(REVEAL_KEY, JSON.stringify(reveal));
        if (nextProgress !== progress) write(PROGRESS_KEY, JSON.stringify(nextProgress));
      } catch (error) {
        fail(error);
      }
    },
    [catalog, update, write, fail],
  );

  const continueRun = useCallback(() => {
    const { run, reveal } = live.current;
    if (!run) return;
    if (run.state.phase === "SETUP") update({ screen: "TALENTS" });
    else update({ screen: reveal?.summarySeen ? "SUMMARY" : "TIMELINE" });
  }, [update]);

  const chooseTalents = useCallback((ids: string[]) => update({ chosen: [...ids], screen: "ALLOCATE" }), [update]);
  const backToTalents = useCallback(() => update({ screen: "TALENTS" }), [update]);

  const beginLife = useCallback(
    (points: Points) => {
      const current = live.current;
      // 已经算完的一局不会再算第二次（连点“开始人生”时第二次到这里就返回）。
      if (!current.run || current.run.state.phase !== "SETUP") return;
      try {
        const result = simulate(current.run.state, { talents: current.chosen, points }, context);
        const reveal: RevealState = { runId: result.state.runId, shown: 0, summarySeen: false };
        update({ run: { state: result.state, log: result.log }, reveal, screen: "TIMELINE" });
        write(SAVE_KEY, serializeSave(result.state, result.log));
        write(REVEAL_KEY, JSON.stringify(reveal));
      } catch (error) {
        fail(error);
      }
    },
    [context, update, write, fail],
  );

  const revealTo = useCallback(
    (shown: number) => {
      const current = live.current.reveal;
      if (!current || !Number.isInteger(shown) || shown < 0 || shown === current.shown) return;
      const reveal = { ...current, shown };
      update({ reveal });
      write(REVEAL_KEY, JSON.stringify(reveal));
    },
    [update, write],
  );

  const openSummary = useCallback(() => {
    const current = live.current;
    if (!current.run || current.run.state.phase === "SETUP" || !current.reveal) return;
    try {
      const progress = settled(current);
      const reveal = current.reveal.summarySeen ? current.reveal : { ...current.reveal, summarySeen: true };
      update({ progress, reveal, screen: "SUMMARY" });
      if (progress !== current.progress) write(PROGRESS_KEY, JSON.stringify(progress));
      if (reveal !== current.reveal) write(REVEAL_KEY, JSON.stringify(reveal));
    } catch (error) {
      fail(error);
    }
  }, [settled, update, write, fail]);

  const setInherit = useCallback(
    (id: string | null) => {
      const progress = live.current.progress;
      if (progress.inherit === id) return;
      const next = { ...progress, inherit: id };
      update({ progress: next });
      write(PROGRESS_KEY, JSON.stringify(next));
    },
    [update, write],
  );

  const discardSave = useCallback(() => {
    update({ screen: "HOME", run: null, chosen: [], reveal: null });
    write(SAVE_KEY, null);
    write(REVEAL_KEY, null);
    setBoot({ kind: "ready" });
  }, [update, write]);

  const recover = useCallback(() => {
    update({ screen: "HOME" });
    setBoot({ kind: "ready" });
  }, [update]);

  const store = useMemo<GameStore>(() => {
    const runId = session.run?.state.runId ?? null;
    const last = session.progress.lastRewards;
    return {
      boot,
      catalog,
      saveStatus,
      screen: session.screen,
      run: session.run?.state ?? null,
      chosenTalents: session.chosen,
      reveal: session.reveal,
      progress: session.progress,
      rewards: last && last.runId === runId ? { achievements: last.achievements, unlockedTalent: last.unlockedTalent } : null,
      goHome,
      startRun,
      continueRun,
      chooseTalents,
      backToTalents,
      beginLife,
      revealTo,
      openSummary,
      setInherit,
      discardSave,
      recover,
    };
  }, [
    boot, catalog, saveStatus, session, goHome, startRun, continueRun, chooseTalents, backToTalents, beginLife, revealTo,
    openSummary, setInherit, discardSave, recover,
  ]);

  return <GameContext.Provider value={store}>{props.children}</GameContext.Provider>;
}

export function useGame(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error("useGame 必须在 GameProvider 内使用");
  return store;
}
