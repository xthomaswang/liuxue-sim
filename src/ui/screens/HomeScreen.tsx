// 首页：标题、一句话、立即重开；有没看完的一局时可以继续。次级入口：图册、指定种子。

import { useState } from "react";
import { parseSeed } from "../../app/seed";
import { useGame } from "../../app/store";
import { APP_TITLE, S } from "../strings";

export function HomeScreen(props: { onOpenGallery: () => void }) {
  const store = useGame();
  const [seedText, setSeedText] = useState("");
  const [seedError, setSeedError] = useState(false);

  const seen = store.reveal?.summarySeen === true;
  const unfinished = store.run !== null && !seen;
  const finished = store.run !== null && store.run.phase === "ENDING" && seen;

  const applySeed = () => {
    const seed = parseSeed(seedText);
    if (seed === null) {
      setSeedError(true);
      return;
    }
    setSeedError(false);
    store.startRun(seed);
  };

  return (
    <div className="screen home" data-testid="screen-home">
      <h1 className="hero-title" data-testid="stage-title">
        {APP_TITLE}
      </h1>
      <p className="prose center">{S.homeLead}</p>

      <div className="stack">
        <button type="button" className="button primary big" data-testid="start-run" onClick={() => store.startRun()}>
          {S.startRun}
        </button>
        {unfinished ? (
          <button type="button" className="button big" data-testid="continue-run" onClick={store.continueRun}>
            {S.continueRun}
          </button>
        ) : null}
      </div>

      <div className="secondary">
        <button type="button" className="link-button" data-testid="open-gallery" onClick={props.onOpenGallery}>
          {S.galleryOpen}
        </button>
        {finished ? (
          <button type="button" className="link-button" data-testid="view-last" onClick={store.continueRun}>
            {S.viewLast}
          </button>
        ) : null}
        <div className="seed-row">
          <label htmlFor="seed-input" className="label">
            {S.seedLabel}
          </label>
          <input
            id="seed-input"
            type="text"
            inputMode="numeric"
            value={seedText}
            autoComplete="off"
            data-testid="seed-input"
            onChange={(event) => setSeedText(event.target.value)}
          />
          <button type="button" className="ghost-button" data-testid="seed-apply" onClick={applySeed}>
            {S.seedApply}
          </button>
        </div>
        {seedError ? (
          <p className="warn small" role="alert">
            {S.seedInvalid}
          </p>
        ) : null}
      </div>

      <p className={`save-status ${store.saveStatus}`} role="status" data-testid="save-status">
        {store.saveStatus === "saved" ? S.saved : S.unsaved}
      </p>
    </div>
  );
}
