// 根组件：单页、无路由，按 state.phase 切换界面。

import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { GameProvider, useGame } from "../app/store";
import type { SaveStorage } from "../app/storage";
import { stageInfo } from "../engine";
import type { RunState, RuntimeCatalog } from "../engine";
import { StatStrip } from "./components";
import { EndingScreen } from "./screens/EndingScreen";
import { EventScreen } from "./screens/EventScreen";
import { FocusScreen } from "./screens/FocusScreen";
import { GalleryScreen } from "./screens/GalleryScreen";
import { GradScreen } from "./screens/GradScreen";
import { OffersScreen } from "./screens/OffersScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { APP_TITLE, S, TIER_NAME, TIER_ORDER } from "./strings";

export function App(props: { catalog?: RuntimeCatalog; storage?: SaveStorage }) {
  return (
    <GameProvider catalog={props.catalog} storage={props.storage}>
      <Shell />
    </GameProvider>
  );
}

function Shell() {
  const store = useGame();
  const { boot, state } = store;

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
          <ul className="inline-list">
            {TIER_ORDER.map((tier) => (
              <li key={tier}>
                {TIER_NAME[tier]} {boot.counts[tier]}
              </li>
            ))}
          </ul>
          <p className="muted small">{boot.message}</p>
          <p className="muted small">{S.catalogProblemNote}</p>
        </section>
      </Frame>
    );
  }

  if (boot.kind === "save-problem") {
    return (
      <Frame>
        <section className="panel" data-testid="save-problem" role="alert">
          <h1 className="title">{boot.reason === "CORRUPT" ? S.saveProblemTitle : S.saveOutdatedTitle}</h1>
          <p className="prose">{boot.reason === "CORRUPT" ? S.saveProblemCorrupt : S.saveProblemVersion}</p>
          <p className="prose">{boot.reason === "CORRUPT" ? S.saveProblemNote : S.saveOutdatedNote}</p>
          <p className="muted small">{boot.detail}</p>
          <button type="button" className="button primary" data-testid="save-problem-restart" onClick={() => store.restart()}>
            {S.restart}
          </button>
        </section>
      </Frame>
    );
  }

  if (boot.kind === "fatal" || !state) {
    return <FatalScreen message={boot.kind === "fatal" ? boot.message : ""} onRestart={() => store.restart()} />;
  }

  return (
    <ScreenBoundary resetKey={state.runId} onRestart={() => store.restart()}>
      <Game state={state} />
    </ScreenBoundary>
  );
}

function Frame(props: { children: ReactNode }) {
  return (
    <div className="app standalone" data-testid="app">
      <main className="content">{props.children}</main>
    </div>
  );
}

function FatalScreen(props: { message: string; onRestart: () => void }) {
  return (
    <Frame>
      <section className="panel" data-testid="fatal" role="alert">
        <h1 className="title">{S.fatalTitle}</h1>
        <p className="prose">{S.fatalLead}</p>
        {props.message ? <p className="muted small">{props.message}</p> : null}
        <button type="button" className="button primary" data-testid="fatal-restart" onClick={props.onRestart}>
          {S.restart}
        </button>
      </section>
    </Frame>
  );
}

function Game(props: { state: RunState }) {
  const { state } = props;
  const store = useGame();
  const [view, setView] = useState<"game" | "gallery">("game");
  const [confirming, setConfirming] = useState(false);
  const info = stageInfo(state);
  const mainRef = useRef<HTMLElement | null>(null);

  // 每走一步（或切换图鉴）都从新界面的顶部开始读，键盘焦点也回到内容区，不留在已经消失的按钮上。
  useEffect(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop = 0;
    mainRef.current?.focus({ preventScroll: true });
  }, [state.runId, state.revision, view]);

  const needsConfirm = state.phase !== "SETUP" && state.phase !== "ENDING";
  const doRestart = () => {
    setConfirming(false);
    setView("game");
    store.restart();
  };
  const onRestartClick = () => {
    if (needsConfirm) setConfirming(true);
    else doRestart();
  };

  // 被拒绝的操作里，过期/重复的那种不打扰玩家；其它原因给一行说明。
  const rejected = store.rejected && store.rejected.code !== "STALE_REVISION" ? store.rejected : null;

  return (
    <div
      className="app"
      data-testid="app"
      data-phase={state.phase}
      data-revision={state.revision}
      data-seed={state.seed}
      data-run-id={state.runId}
    >
      <header className="topbar">
        <div className="topbar-row">
          <div className="stage">
            <h1 className="stage-title" data-testid="stage-title">
              {info.stage === "SETUP" ? APP_TITLE : info.title}
            </h1>
            {info.step ? <span className="stage-step">{info.step}</span> : null}
          </div>
          <div className="topbar-actions">
            <span className={`save-status ${store.saveStatus}`} role="status" data-testid="save-status">
              {store.saveStatus === "saved" ? S.saved : S.unsaved}
            </span>
            <button type="button" className="ghost-button" data-testid="restart" onClick={onRestartClick}>
              {state.phase === "SETUP" ? S.reroll : S.restart}
            </button>
          </div>
        </div>
        {state.phase !== "SETUP" ? <StatStrip stats={state.stats} /> : null}
      </header>

      <main className="content" key={`${state.runId}:${state.revision}:${view}`} ref={mainRef} tabIndex={-1}>
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
        {confirming ? (
          <div className="notice confirm" role="alertdialog" aria-label={S.restart} data-testid="restart-confirm">
            <p>{S.restartConfirmText}</p>
            <div className="actions">
              <button type="button" className="button" data-testid="restart-no" onClick={() => setConfirming(false)}>
                {S.restartConfirmNo}
              </button>
              <button type="button" className="button danger" data-testid="restart-yes" onClick={doRestart}>
                {S.restartConfirmYes}
              </button>
            </div>
          </div>
        ) : null}
        {rejected ? (
          <p className="notice warn" role="alert" data-testid="rejected">
            {S.rejectedPrefix}
            {rejected.message}
          </p>
        ) : null}

        {view === "gallery" ? (
          <GalleryScreen onClose={() => setView("game")} />
        ) : (
          <PhaseScreen state={state} onOpenGallery={() => setView("gallery")} />
        )}
      </main>

      {state.phase !== "ENDING" ? (
        <footer className="footer">
          <span className="muted small">{S.seedLine(state.seed)}</span>
        </footer>
      ) : null}
    </div>
  );
}

function PhaseScreen(props: { state: RunState; onOpenGallery: () => void }) {
  const { state } = props;
  switch (state.phase) {
    case "SETUP":
      return <SetupScreen state={state} onOpenGallery={props.onOpenGallery} />;
    case "HIGH_SCHOOL_EVENT":
    case "CORE_EVENT":
    case "ARC_EVENT":
      return <EventScreen state={state} />;
    case "SCHOOL_OFFERS":
      return <OffersScreen state={state} />;
    case "FOCUS":
      return <FocusScreen state={state} />;
    case "GRAD_PREVIEW":
    case "GRAD_RESULTS":
      return <GradScreen state={state} />;
    case "ENDING":
      return <EndingScreen state={state} onOpenGallery={props.onOpenGallery} />;
  }
}

/** 某个界面渲染出错时不让整页变白：给出说明与重新开始。新开一局（runId 变化）后自动恢复。 */
class ScreenBoundary extends Component<
  { resetKey: string; onRestart: () => void; children: ReactNode },
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
    if (this.state.message !== null) {
      return <FatalScreen message={this.state.message} onRestart={this.props.onRestart} />;
    }
    return this.props.children;
  }
}
