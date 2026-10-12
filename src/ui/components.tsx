// 各界面共用的小组件。全部是纯展示：展开、收起都只改组件自己的状态，不碰游戏状态。

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { TEXTS } from "../content";
import type { Delta, FocusCounts, LastOutcome, OpportunityView, SceneIntro, Stats, TierOdds } from "../engine";
import { deltaItems, hundredthsText, oddsText, rollText, signed } from "./format";
import { FOCUS_ORDER, FOCUS_SHORT, OUTCOME_LABEL, S, STAT_ORDER, STAT_SHORT } from "./strings";

export function Expandable(props: { label: string; closeLabel?: string; testId?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="expandable">
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        aria-controls={id}
        data-testid={props.testId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (props.closeLabel ?? S.collapse) : props.label}
      </button>
      {open ? (
        <div id={id} className="expandable-body">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

/** 顶栏里的四属性当前值。 */
export function StatStrip(props: { stats: Stats }) {
  return (
    <dl className="stat-strip">
      {STAT_ORDER.map((key) => (
        <div className="stat" key={key} title={TEXTS.stat[key].meaning}>
          <dt>{TEXTS.stat[key].name}</dt>
          <dd data-testid={`stat-${key}`}>{props.stats[key]}</dd>
          <div className="stat-bar" aria-hidden="true">
            <span style={{ width: `${props.stats[key]}%` }} />
          </div>
        </div>
      ))}
    </dl>
  );
}

/** 一行属性数值，用于冻结快照、初始属性等。 */
export function StatLine(props: { stats: Stats }) {
  return (
    <ul className="inline-list">
      {STAT_ORDER.map((key) => (
        <li key={key}>
          {STAT_SHORT[key]} {props.stats[key]}
        </li>
      ))}
    </ul>
  );
}

export function FocusCountLine(props: { counts: FocusCounts }) {
  return (
    <ul className="inline-list">
      {FOCUS_ORDER.map((focus) => (
        <li key={focus}>
          {FOCUS_SHORT[focus]} {props.counts[focus]}
        </li>
      ))}
    </ul>
  );
}

/** 实际发生（或将要发生）的属性变化。被上下限截断时，在数值旁注明原因与名义值。 */
export function DeltaLine(props: { delta: Delta; showEmpty?: boolean }) {
  const items = deltaItems(props.delta);
  if (items.length === 0) return props.showEmpty ? <p className="muted small">{S.noChange}</p> : null;
  return (
    <span className="delta">
      {items.map((item) => (
        <span
          key={item.key}
          className={`chip ${item.applied > 0 ? "pos" : item.applied < 0 ? "neg" : "zero"}`}
          data-stat={item.key}
        >
          {STAT_SHORT[item.key]} {signed(item.applied)}
          {item.clipped ? (
            <span className="chip-note">
              （{item.requested > item.applied ? S.clippedHigh : S.clippedLow}，名义 {signed(item.requested)}）
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** 上一步操作留下的结果：短结果与实际变化，长结果可展开。 */
export function OutcomePanel(props: { outcome: LastOutcome | null }) {
  const outcome = props.outcome;
  if (!outcome) return null;
  return (
    <section className="panel outcome" data-testid="last-outcome" aria-label={S.lastOutcomeHeading}>
      <p className="eyebrow">
        {S.lastOutcomeHeading} · {outcome.heading}
      </p>
      {outcome.choiceLabel ? <p className="outcome-choice">{outcome.choiceLabel}</p> : null}
      <p className="prose">{outcome.shortText}</p>
      <DeltaLine delta={outcome.delta} showEmpty />
      {outcome.longText ? (
        <Expandable label={S.resultExpand} testId="expand-result">
          <p className="prose">{outcome.longText}</p>
        </Expandable>
      ) : null}
    </section>
  );
}

/** 场景旁白。hideShort：短文与紧跟着的事件摘要重复时，只留可展开的长文。 */
export function IntroPanel(props: { intro: SceneIntro | null; hideShort?: boolean }) {
  if (!props.intro) return null;
  return (
    <section className="panel intro" data-testid="scene-intro">
      {props.hideShort ? null : <p className="prose">{props.intro.short}</p>}
      <Expandable label={S.introExpand} testId="expand-intro">
        <p className="prose">{props.intro.long}</p>
      </Expandable>
    </section>
  );
}

/** 六档（含未分档）的概率，一行排开。 */
export function OddsRow(props: { odds: TierOdds[] }) {
  return (
    <span className="odds">
      {props.odds.map((item) => (
        <span key={item.tier} className="odds-item">
          {oddsText(item)}
        </span>
      ))}
    </span>
  );
}

/** 一条毕业机会：资格、整数概率、（揭晓后）结果，分解与抽签记录可展开。compact 时资格条件也折叠。 */
export function OpportunityCard(props: { view: OpportunityView; compact?: boolean }) {
  const view = props.view;
  const outcome = view.outcome;
  const total = view.breakdown.reduce((sum, line) => sum + line.hundredths, 0);
  const odds =
    view.eligible && view.probability !== null ? S.probability(view.probability) : outcome ? null : S.ineligible;
  return (
    <li className={`opportunity ${outcome ? outcome.toLowerCase() : "pending"}`} data-testid={`opportunity-${view.id}`}>
      <div className="opportunity-head">
        <span className="opportunity-name">{view.name}</span>
        {odds ? <span className="opportunity-odds">{odds}</span> : null}
      </div>
      {outcome ? (
        <p className="opportunity-outcome" data-testid={`outcome-${view.id}`}>
          {OUTCOME_LABEL[outcome]}
        </p>
      ) : null}
      {!view.eligible && !props.compact ? <Requirements view={view} /> : null}
      {!view.eligible && props.compact ? (
        <Expandable label={S.requirementsExpand} testId={`expand-requirements-${view.id}`}>
          <Requirements view={view} />
        </Expandable>
      ) : null}
      {view.eligible ? (
        <Expandable label={S.breakdownExpand} testId={`expand-breakdown-${view.id}`}>
          <Requirements view={view} />
          <ul className="ledger">
            {view.breakdown.map((line, index) => (
              <li key={index}>
                <span>{line.label}</span>
                <span className="num">{hundredthsText(line.hundredths)}</span>
              </li>
            ))}
            <li className="ledger-total">
              <span>{S.breakdownTotal(hundredthsText(total))}</span>
              <span className="num">{view.probability !== null ? `${view.probability}%` : ""}</span>
            </li>
          </ul>
          {view.clampedTo === "MIN" ? <p className="muted small">{S.clampedMin}</p> : null}
          {view.clampedTo === "MAX" ? <p className="muted small">{S.clampedMax}</p> : null}
          {view.roll !== null && view.probability !== null ? (
            <p className="muted small">{S.rollLine(rollText(view.roll), view.probability)}</p>
          ) : null}
        </Expandable>
      ) : null}
    </li>
  );
}

function Requirements(props: { view: OpportunityView }) {
  if (props.view.requirements.length === 0) return null;
  return (
    <div className="requirements">
      <p className="muted small">{S.requirementsHeading}</p>
      <ul className="check-list">
        {props.view.requirements.map((item, index) => (
          <li key={index} className={item.met ? "met" : "unmet"}>
            <span aria-hidden="true">{item.met ? "✓" : "○"}</span> {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
