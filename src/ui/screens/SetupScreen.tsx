// 开局一屏：上面是抽出来的出身，下面十张天赋里选满 pickCount 张就能开始。

import { useMemo, useState } from "react";
import { parseSeed } from "../../app/seed";
import { useGame } from "../../app/store";
import { TEXTS } from "../../content";
import { setupView } from "../../engine";
import type { SetupRun } from "../../engine";
import { RarityTag, StatLine } from "../components";
import { S } from "../strings";

export function SetupScreen(props: { state: SetupRun; onOpenGallery: () => void }) {
  const { state } = props;
  const { dispatch, restart } = useGame();
  const view = useMemo(() => setupView(state), [state]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [seedText, setSeedText] = useState("");
  const [seedError, setSeedError] = useState(false);

  const { origin } = view;
  const full = chosen.length >= view.pickCount;

  const toggle = (id: string) => {
    setChosen((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= view.pickCount ? current : [...current, id];
    });
  };

  const start = () => {
    if (chosen.length !== view.pickCount) return;
    // 按抽出顺序提交，和点击先后无关。
    dispatch({ type: "CONFIRM_SETUP", talents: view.draw.filter((talent) => chosen.includes(talent.id)).map((talent) => talent.id) });
  };

  const applySeed = () => {
    const seed = parseSeed(seedText);
    if (seed === null) {
      setSeedError(true);
      return;
    }
    setSeedError(false);
    restart(seed);
  };

  return (
    <div className="screen" data-testid="screen-setup">
      <section className="panel" data-testid="origin-card">
        <p className="eyebrow">{S.originEyebrow}</p>
        <h2 className="title">{TEXTS.economy[origin.economy].cardName}</h2>
        <p className="prose">
          {TEXTS.economy[origin.economy].cardText}
          {TEXTS.expectation[origin.expectation].cardText}
        </p>
        <p className="prose">
          {S.aspirationPrefix}
          {TEXTS.aspiration[origin.aspiration].choice}
        </p>
        <p className="small">
          <StatLine stats={origin.initialStats} />
        </p>
        <p className="muted small">
          {S.originAccount(origin.stipend, origin.upkeep)} · <span data-testid="base-readiness">{S.readinessLabel(view.baseReadiness)}</span>
        </p>
      </section>

      <section aria-label={S.talentHeading(view.pickCount)}>
        <h3 className="section-heading">
          {S.talentHeading(view.pickCount)}
          <span className="muted small" data-testid="talent-count">
            {S.talentCount(chosen.length, view.pickCount)}
          </span>
        </h3>
        {view.draw.length === 0 ? <p className="warn small">{S.talentEmpty}</p> : null}
        <div className="talent-grid">
          {view.draw.map((talent) => {
            const selected = chosen.includes(talent.id);
            return (
              <button
                key={talent.id}
                type="button"
                className={`choice talent rarity-border-${talent.rarity}${selected ? " selected" : ""}`}
                aria-pressed={selected}
                disabled={!selected && full}
                data-testid={`talent-${talent.id}`}
                data-rarity={talent.rarity}
                onClick={() => toggle(talent.id)}
              >
                <span className="talent-head">
                  <RarityTag rarity={talent.rarity} />
                  <span className="choice-label">{talent.name}</span>
                </span>
                <span className="small">{talent.text}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="button primary wide"
          disabled={chosen.length !== view.pickCount}
          data-testid="start"
          onClick={start}
        >
          {S.start}
        </button>
      </section>

      <section className="secondary">
        <div className="seed-row">
          <label htmlFor="seed-input" className="label" data-testid="seed-toggle">
            {S.seedLabel}
          </label>
          <input
            id="seed-input"
            type="text"
            inputMode="numeric"
            value={seedText}
            placeholder={String(state.seed)}
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
        <button type="button" className="link-button" data-testid="open-gallery" onClick={props.onOpenGallery}>
          {S.galleryOpen}
        </button>
      </section>
    </div>
  );
}
