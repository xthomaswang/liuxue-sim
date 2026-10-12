// @vitest-environment jsdom
// 状态仓库：防重复结算、存档损坏、写入失败。

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameProvider, useGame } from "../../app/store";
import type { GameStore } from "../../app/store";
import { SAVE_KEY, createMemoryStorage } from "../../app/storage";
import type { SaveStorage } from "../../app/storage";
import { loadSave } from "../../engine";
import { catalog, click, flush, mount, phase, revision, seededStorage, stats } from "./harness";

afterEach(() => cleanup());

function Probe(props: { sink: { store: GameStore | null } }) {
  props.sink.store = useGame();
  return null;
}

async function mountProbe(storage: SaveStorage) {
  const sink: { store: GameStore | null } = { store: null };
  render(
    <GameProvider catalog={catalog} storage={storage}>
      <Probe sink={sink} />
    </GameProvider>,
  );
  await waitFor(() => expect(sink.store?.boot.kind).toBe("ready"));
  await flush();
  return sink;
}

describe("防重复结算", () => {
  it("同一次渲染里连发两次相同操作，只结算一次，第二次被引擎按过期 revision 拒绝", async () => {
    const sink = await mountProbe(seededStorage(42));
    const store = sink.store as GameStore;
    const before = store.state?.revision ?? -1;
    let first = { ok: false };
    let second: ReturnType<GameStore["dispatch"]> = { ok: true, error: null };
    await act(async () => {
      const action = { type: "CONFIRM_SETUP", economy: "MID", aspiration: "DISCOVERY", name: "" } as const;
      first = store.dispatch(action);
      second = store.dispatch(action);
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("STALE_REVISION");
    expect(sink.store?.state?.revision).toBe(before + 1);
    expect(sink.store?.state?.phase).toBe("HIGH_SCHOOL_EVENT");
  });

  it("被拒绝的操作不改变状态，也不进入存档", async () => {
    const storage = seededStorage(42);
    const sink = await mountProbe(storage);
    const savedBefore = storage.dump()[SAVE_KEY];
    let result: ReturnType<GameStore["dispatch"]> = { ok: true, error: null };
    await act(async () => {
      result = (sink.store as GameStore).dispatch({ type: "NEXT_TERM" });
    });
    expect(result.ok).toBe(false);
    expect(sink.store?.state?.phase).toBe("SETUP");
    expect(sink.store?.state?.revision).toBe(0);
    expect(sink.store?.rejected?.code).toBeTruthy();
    expect(storage.dump()[SAVE_KEY]).toBe(savedBefore);
  });

  it("界面上对同一个投入按钮连点两次，只结算一次", async () => {
    await mount(seededStorage(42));
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    await click("choice-A");
    await click("choice-A");
    await click("offer-0");
    expect(phase()).toBe("FOCUS");
    const before = { revision: revision(), stats: stats() };
    const button = screen.getByTestId("focus-REST");
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(phase()).toBe("CORE_EVENT");
    expect(revision()).toBe(before.revision + 1);
    // 休息整理只加一次身心（+15，受上限 100 截断）。
    expect(stats().wellbeing).toBe(Math.min(100, before.stats.wellbeing + 15));
  });
});

describe("每次有效操作后保存", () => {
  it("存档里的状态始终等于界面上的状态，且能被引擎重放校验通过", async () => {
    const storage = seededStorage(42);
    await mount(storage);
    await click("family-HIGH");
    await click("aspiration-INDEPENDENCE");
    await click("start");
    await click("choice-B");
    const loaded = loadSave(storage.dump()[SAVE_KEY], { catalog });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.state.revision).toBe(revision());
      expect(loaded.state.phase).toBe(phase());
      expect(loaded.log.length).toBe(2);
    }
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
  });
});

describe("存档问题", () => {
  it("损坏的存档不会被静默替换成新局：先说明，再由玩家重新开始", async () => {
    const storage = createMemoryStorage({ [SAVE_KEY]: "{这不是一份存档" });
    await mount(storage);
    expect(screen.getByTestId("save-problem").textContent).toContain("存档读不出来");
    expect(screen.queryByTestId("screen-setup")).toBeNull();
    // 说明页出现时，原来的内容还在存储里，没有被覆盖。
    expect(storage.dump()[SAVE_KEY]).toBe("{这不是一份存档");
    await click("save-problem-restart");
    expect(phase()).toBe("SETUP");
    expect(loadSave(storage.dump()[SAVE_KEY], { catalog }).ok).toBe(true);
  });

  it("被改过数值的存档（结构合法但对不上历史）同样被拒绝", async () => {
    const storage = seededStorage(42);
    const first = await mount(storage);
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    first.unmount();
    const envelope = JSON.parse(storage.dump()[SAVE_KEY]);
    envelope.state.stats.money = 99;
    await storage.write(SAVE_KEY, JSON.stringify(envelope));
    await mount(storage);
    expect(screen.getByTestId("save-problem")).toBeTruthy();
  });

  it("本机存储写不进去时显示“当前未保存”，但可以继续玩", async () => {
    const storage: SaveStorage = {
      read: async () => null,
      write: async () => {
        throw new Error("QuotaExceededError");
      },
      remove: async () => undefined,
    };
    await mount(storage);
    expect(phase()).toBe("SETUP");
    expect(screen.getByTestId("save-status").textContent).toBe("当前未保存");
    expect(screen.getByTestId("unsaved-hint")).toBeTruthy();
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    expect(screen.getByTestId("save-status").textContent).toBe("当前未保存");
  });

  it("写入恢复后回到“已保存”", async () => {
    const inner = createMemoryStorage();
    let failing = true;
    const storage: SaveStorage = {
      read: (key) => inner.read(key),
      write: async (key, value) => {
        if (failing) throw new Error("暂时写不进去");
        await inner.write(key, value);
      },
      remove: (key) => inner.remove(key),
    };
    await mount(storage);
    expect(screen.getByTestId("save-status").textContent).toBe("当前未保存");
    failing = false;
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
    expect(screen.queryByTestId("unsaved-hint")).toBeNull();
  });
});
