// 分点：四项各一行（− 数值 ＋），下方实时显示按当前分配得到的开局。点数用完才能开始人生。

import { useMemo, useState } from "react";
import { randomInt } from "../../app/seed";
import { useGame } from "../../app/store";
import { TEXTS } from "../../content";
import { setupView, startPreview } from "../../engine";
import type { Points, SetupRun } from "../../engine";
import { POINT_NAME, POINT_ORDER, S, STAT_ORDER, STAT_SHORT } from "../strings";

const ZERO: Points = { family: 0, academics: 0, career: 0, wellbeing: 0 };

export function AllocateScreen(props: { state: SetupRun }) {
  const store = useGame();
  const view = useMemo(() => setupView(props.state), [props.state]);
  const [points, setPoints] = useState<Points>(ZERO);
  const preview = startPreview(props.state, store.chosenTalents, points);
  const left = preview.pointBudget - preview.pointsUsed;

  const change = (key: keyof Points, step: number) => {
    setPoints((current) => {
      const value = current[key] + step;
      const used = POINT_ORDER.reduce((sum, item) => sum + current[item], 0);
      if (value < 0 || value > view.pointMax || used + step > preview.pointBudget) return current;
      return { ...current, [key]: value };
    });
  };

  // 界面上的便利功能：把点数随机分完。不属于规则，所以不走 seed。
  const randomize = () => {
    const next: Points = { ...ZERO };
    for (let remaining = preview.pointBudget; remaining > 0; remaining--) {
      const open = POINT_ORDER.filter((key) => next[key] < view.pointMax);
      if (open.length === 0) break;
      next[open[randomInt(open.length)]] += 1;
    }
    setPoints(next);
  };

  return (
    <div className="screen" data-testid="screen-allocate">
      <p className="lead">
        <span data-testid="points-left">{S.pointsLeft(left)}</span>
        <button type="button" className="ghost-button" data-testid="random-allocate" onClick={randomize}>
          {S.randomAllocate}
        </button>
      </p>

      <div className="point-list">
        {POINT_ORDER.map((key) => (
          <div className="point-row" key={key}>
            <span className="point-name">{POINT_NAME[key]}</span>
            <button
              type="button"
              className="point-button"
              aria-label={S.minusLabel(POINT_NAME[key])}
              disabled={points[key] <= 0}
              data-testid={`point-minus-${key}`}
              onClick={() => change(key, -1)}
            >
              {S.minus}
            </button>
            <span className="point-value" data-testid={`point-value-${key}`}>
              {points[key]}
            </span>
            <button
              type="button"
              className="point-button"
              aria-label={S.plusLabel(POINT_NAME[key])}
              disabled={left <= 0 || points[key] >= view.pointMax}
              data-testid={`point-plus-${key}`}
              onClick={() => change(key, 1)}
            >
              {S.plus}
            </button>
          </div>
        ))}
      </div>

      <div className="panel" data-testid="start-preview">
        <p className="small">
          <span className="label">{S.previewStats}</span>
          <span className="inline-list">
            {STAT_ORDER.map((key) => (
              <span key={key} data-testid={`preview-${key}`}>
                {STAT_SHORT[key]} {preview.stats[key]}
              </span>
            ))}
          </span>
        </p>
        <p className="muted small">
          {TEXTS.economy[preview.economy].cardName} · {S.previewAccount(preview.stipend, preview.upkeep, preview.readiness)}
        </p>
        <p className="muted small">
          {S.familyPrefix}
          {TEXTS.expectation[view.origin.expectation].cardText}
        </p>
        <p className="muted small">
          {S.aspirationPrefix}
          {TEXTS.aspiration[view.origin.aspiration].choice}
        </p>
      </div>

      <div className="actions">
        <button type="button" className="button" data-testid="back-to-talents" onClick={store.backToTalents}>
          {S.back}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!preview.valid}
          data-testid="begin-life"
          onClick={() => store.beginLife(points)}
        >
          {S.beginLife}
        </button>
      </div>
    </div>
  );
}
