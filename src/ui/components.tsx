// 各界面共用的小组件，全部是纯展示。
// 版面约定（docs/16 第 6 节）：状态行（各占一行小字）→ 一小段描述 → 选项按钮；没有可展开的长文。

import type { ReactNode } from "react";
import { TEXTS } from "../content";
import type { Delta, LastOutcome, OpportunityView, Stats, Talent, TermLedger, TierOdds } from "../engine";
import { deltaItems, oddsText, settlementDelta, signed } from "./format";
import { OUTCOME_LABEL, S, STAT_ORDER, STAT_SHORT } from "./strings";

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

/** 一行属性数值。 */
export function StatLine(props: { stats: Stats }) {
  return (
    <span className="inline-list">
      {STAT_ORDER.map((key) => (
        <span key={key}>
          {STAT_SHORT[key]} {props.stats[key]}
        </span>
      ))}
    </span>
  );
}

/** 实际发生（或将要发生）的属性变化。被上下限截断时在数值旁注明。 */
export function DeltaLine(props: { delta: Delta }) {
  const items = deltaItems(props.delta);
  if (items.length === 0) return null;
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
            <span className="chip-note">（{item.requested > item.applied ? S.clippedHigh : S.clippedLow}）</span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** 状态行：一个小标签加一句话，放在描述上方。 */
export function StatusLine(props: { label: string; testId?: string; warn?: boolean; children: ReactNode }) {
  return (
    <p className={`status-line${props.warn ? " warn" : ""}`} data-testid={props.testId}>
      <span className="status-label">{props.label}</span>
      {props.children}
    </p>
  );
}

/** 上一步的结果：短结果与实际变化。 */
export function OutcomeLine(props: { outcome: LastOutcome | null }) {
  if (!props.outcome) return null;
  return (
    <StatusLine label={S.statusLast} testId="last-outcome">
      {props.outcome.shortText} <DeltaLine delta={props.outcome.delta} />
    </StatusLine>
  );
}

/** 刚结束那个学期的结算：必要开销、短缺压力、基础成长合成一行。 */
export function SettlementLine(props: { ledger: TermLedger | null; final?: boolean }) {
  const ledger = props.ledger;
  if (!ledger) return null;
  return (
    <StatusLine label={props.final ? S.statusFinalSettlement : S.statusSettlement} testId="term-settlement">
      <DeltaLine delta={settlementDelta(ledger)} />
      {ledger.shortfall > 0 ? <span className="warn"> {S.settlementShortfall(ledger.shortfall, ledger.stress)}</span> : null}
    </StatusLine>
  );
}

export function StatusBlock(props: { children: ReactNode }) {
  return <div className="status">{props.children}</div>;
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

export function RarityTag(props: { rarity: Talent["rarity"] }) {
  return <span className={`rarity rarity-${props.rarity}`}>{props.rarity}</span>;
}

/** 一条毕业机会占一行：名称、概率或“准备尚不足”、（揭晓后）结果。准备不足时把资格条件列在下面（bare 时不列）。 */
export function OpportunityRow(props: { view: OpportunityView; bare?: boolean }) {
  const view = props.view;
  const outcome = view.outcome;
  const odds = view.eligible && view.probability !== null ? S.probability(view.probability) : outcome ? null : S.ineligible;
  return (
    <li className={`opportunity ${outcome ? outcome.toLowerCase() : "pending"}`} data-testid={`opportunity-${view.id}`}>
      <div className="opportunity-head">
        <span className="opportunity-name">{view.name}</span>
        {outcome ? (
          <span className="opportunity-outcome" data-testid={`outcome-${view.id}`}>
            {OUTCOME_LABEL[outcome]}
          </span>
        ) : null}
        {odds ? <span className="opportunity-odds">{odds}</span> : null}
      </div>
      {!props.bare && !view.eligible && view.requirements.length > 0 ? (
        <ul className="check-list">
          <li className="muted">{S.requirementsHeading}</li>
          {view.requirements.map((item, index) => (
            <li key={index} className={item.met ? "met" : "unmet"}>
              <span aria-hidden="true">{item.met ? "✓" : "○"}</span> {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
