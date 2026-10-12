// 根组件：单页、无路由。屏只有五个——首页、天赋、分点、人生轨迹、人生总结——外加图册与几个提示页。

import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { GameProvider, useGame } from "../app/store";
import type { Screen } from "../app/store";
import type { SaveStorage } from "../app/storage";
import { timeline } from "../engine";
import type { RuntimeCatalog, Stats } from "../engine";
import { StatStrip } from "./components";
import { AllocateScreen } from "./screens/AllocateScreen";
import { GalleryScreen } from "./screens/GalleryScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TalentScreen } from "./screens/TalentScreen";
import { TimelineScreen } from "./screens/TimelineScreen";
import { S, SCREEN_TITLE, TIER_NAME, TIER_ORDER } from "./strings";

export function App(props: { catalog?: RuntimeCatalog; storage?: SaveStorage }) {
  return (
    <GameProvider catalog={props.catalog} storage={props.storage}>
      <Shell />
    </GameProvider>
  );
}

function Shell() {
  const store = useGame();
  const { boot } = store;

  if (boot.kind === "loading") {
    return (
      <Frame>
        <p className="muted" role="status">
          {S.loading}
        </p>
      </Frame>
    );
  }

  if (boot.kind === "catalog-problem") {
    return (
      <Frame>
        <section className="panel" data-testid="catalog-problem" role="alert">
          <h1 className="title">{S.catalogProblemTitle}</h1>
          <p className="prose">{S.catalogProblemLead}</p>
          <p className="inline-list">
            {TIER_ORDER.map((tier) => (
              <span key={tier}>
                {TIER_NAME[tier]} {boot.counts[tier]}
              </span>
            ))}
          </p>
          <p className="muted small">{boot.message}</p>
          <p className="muted small">{S.catalogProblemNote}</p>
        </section>
      </Frame>
    );
  }

  if (boot.kind === "save-problem") {
    return (
      <Frame>
        <section className="panel" data-testid="save-problem" data-reason={boot.reason} role="alert">
          {/* 版本不符只是游戏更新了，不是存档坏了：两种情况用不同的说法。 */}
          <h1 className="title">{boot.reason === "CORRUPT" ? S.saveProblemTitle : S.saveOutdatedTitle}</h1>
          <p className="prose">{boot.reason === "CORRUPT" ? S.saveProblemCorrupt : S.saveProblemVersion}</p>
          <p className="prose">{boot.reason === "CORRUPT" ? S.saveProblemNote : S.saveOutdatedNote}</p>
          <p className="muted small">{boot.detail}</p>
          <button type="button" className="button primary" data-testid="save-problem-restart" onClick={store.discardSave}>
            {boot.reason === "CORRUPT" ? S.saveProblemDiscard : S.saveOutdatedConfirm}
          </button>
        </section>
      </Frame>
    );
  }

  if (boot.kind === "fatal") return <FatalScreen message={boot.message} onHome={store.recover} />;

  return (
    <ScreenBoundary resetKey={`${store.screen}:${store.run?.runId ?? ""}`} onHome={store.recover}>
      <Game />
    </ScreenBoundary>
  );
}

/** 没有顶栏的独立提示页。 */
function Frame(props: { children: ReactNode }) {
  return (
    <div className="app standalone" data-testid="app">
      <main className="content">{props.children}</main>
    </div>
  );
}

function FatalScreen(props: { message: string; onHome: () => void }) {
  return (
    <Frame>
      <section className="panel" data-testid="fatal" role="alert">
        <h1 className="title">{S.fatalTitle}</h1>
        <p className="prose">{S.fatalLead}</p>
        {props.message ? <p className="muted small">{props.message}</p> : null}
        <button type="button" className="button primary" data-testid="fatal-restart" onClick={props.onHome}>
          {S.home}
        </button>
      </section>
    </Frame>
  );
}

function Game() {
  const store = useGame();
  const { run } = store;
  const [gallery, setGallery] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  // 屏与存档对不上时（例如还没有一局却要显示轨迹）退回首页。
  const screen: Screen =
    (store.screen === "TALENTS" || store.screen === "ALLOCATE") && run?.phase !== "SETUP"
      ? "HOME"
      : (store.screen === "TIMELINE" || store.screen === "SUMMARY") && (run === null || run.phase === "SETUP")
        ? "HOME"
        : store.screen;

  const ended = run !== null && run.phase !== "SETUP" ? run : null;
  const entries = useMemo(() => (ended && screen === "TIMELINE" ? timeline(ended) : []), [ended, screen]);
  const shown = Math.min(store.reveal?.shown ?? 0, entries.length);
  // 人生轨迹顶部的四属性：显示到当前这一段为止；还没开始时是开局的数值。
  const stripStats: Stats | null =
    ended && screen === "TIMELINE" && entries.length > 0
      ? shown > 0
        ? entries[shown - 1].statsAfter
        : (ended.history[0]?.beforeStats ?? entries[0].statsAfter)
      : null;

  // 换屏时从顶部开始读，键盘焦点回到内容区。人生轨迹自己管滚动（新的一段出现就滚到底）。
  useEffect(() => {
    if (screen !== "TIMELINE" || gallery) {
      const scroller = document.scrollingElement ?? document.documentElement;
      scroller.scrollTop = 0;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [screen, gallery, run?.runId]);

  const showTopbar = gallery || screen !== "HOME";
  const goHome = () => {
    setGallery(false);
    store.goHome();
  };

  return (
    <div className="app" data-testid="app" data-phase={screen} data-seed={run?.seed} data-run-id={run?.runId}>
      {showTopbar ? (
        <header className="topbar">
          <div className="topbar-row">
            <h1 className="stage-title" data-testid="stage-title">
              {gallery ? SCREEN_TITLE.GALLERY : SCREEN_TITLE[screen]}
            </h1>
            <div className="topbar-actions">
              <span className={`save-status ${store.saveStatus}`} role="status" data-testid="save-status">
                {store.saveStatus === "saved" ? S.saved : S.unsaved}
              </span>
              {screen !== "HOME" ? (
                <button type="button" className="ghost-button" data-testid="go-home" onClick={goHome}>
                  {S.home}
                </button>
              ) : null}
            </div>
          </div>
          {stripStats && !gallery ? <StatStrip stats={stripStats} /> : null}
        </header>
      ) : null}

      <main className="content" key={`${screen}:${gallery}:${run?.runId ?? ""}`} ref={mainRef} tabIndex={-1}>
        {store.catalog.mode === "SAMPLE" ? (
          <p className="notice sample" data-testid="sample-banner">
            {S.sampleBanner}
          </p>
        ) : null}
        {store.saveStatus === "unsaved" ? (
          <p className="notice warn" data-testid="unsaved-hint">
            {S.unsavedHint}
          </p>
        ) : null}

        {gallery ? (
          <GalleryScreen onClose={() => setGallery(false)} />
        ) : screen === "HOME" ? (
          <HomeScreen onOpenGallery={() => setGallery(true)} />
        ) : screen === "TALENTS" && run?.phase === "SETUP" ? (
          <TalentScreen state={run} />
        ) : screen === "ALLOCATE" && run?.phase === "SETUP" ? (
          <AllocateScreen state={run} />
        ) : screen === "TIMELINE" && ended ? (
          <TimelineScreen entries={entries} shown={shown} />
        ) : screen === "SUMMARY" && ended ? (
          <SummaryScreen state={ended} onOpenGallery={() => setGallery(true)} />
        ) : null}
      </main>
    </div>
  );
}

/** 某一屏渲染出错时不让整页变白：给出说明与回首页。换屏或换一局后自动恢复。 */
class ScreenBoundary extends Component<
  { resetKey: string; onHome: () => void; children: ReactNode },
  { message: string | null; failedKey: string | null }
> {
  override state: { message: string | null; failedKey: string | null } = { message: null, failedKey: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(): void {
    this.setState({ failedKey: this.props.resetKey });
  }

  override componentDidUpdate(): void {
    if (this.state.message !== null && this.state.failedKey !== null && this.state.failedKey !== this.props.resetKey) {
      this.setState({ message: null, failedKey: null });
    }
  }

  override render(): ReactNode {
    if (this.state.message !== null) return <FatalScreen message={this.state.message} onHome={this.props.onHome} />;
    return this.props.children;
  }
}
