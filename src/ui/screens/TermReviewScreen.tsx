// 学期小结：刚完成事件的结果 + 本学期紧凑账目，一个“继续”就进入下一学期或毕业机会。

import { useGame } from "../../app/store";
import { lastOutcome, termLedger } from "../../engine";
import type { ActiveRun } from "../../engine";
import { DeltaLine, OutcomePanel, StatLine } from "../components";
import { S } from "../strings";

export function TermReviewScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const ledger = termLedger(state);
  if (!ledger) return null;

  return (
    <div className="screen" data-testid="screen-term-review">
      <OutcomePanel outcome={lastOutcome(state)} />

      <section className="panel">
        <p className="eyebrow">{ledger.title}</p>
        <h2 className="title">{S.termReviewHeading}</h2>
        <ul className="ledger" data-testid="term-ledger">
          {ledger.lines.map((line, index) => (
            <li key={index} data-kind={line.kind}>
              <span>
                {line.label}
                {line.detail ? <span className="muted small"> · {line.detail}</span> : null}
              </span>
              <DeltaLine delta={line.delta} />
            </li>
          ))}
        </ul>
        {ledger.shortfall > 0 ? (
          <p className="warn small" data-testid="shortfall-note">
            {S.shortfallLine(ledger.shortfall, ledger.stress)}
          </p>
        ) : null}
        <div className="small">
          <span className="label">{S.endStats}</span>
          <StatLine stats={ledger.endStats} />
        </div>
      </section>

      <button
        type="button"
        className="button primary wide"
        data-testid="next-term"
        onClick={() => dispatch({ type: "NEXT_TERM" })}
      >
        {ledger.isFinalTerm ? S.toGraduation : S.nextTerm}
      </button>
    </div>
  );
}
