// 每学期一次的投入选择。五项的实际收益（含特质与身心效率）同屏可见。

import { useGame } from "../../app/store";
import { focusView, lastOutcome, sceneIntro } from "../../engine";
import type { ActiveRun } from "../../engine";
import { DeltaLine, IntroPanel, OutcomePanel } from "../components";
import { asDelta } from "../format";
import { S } from "../strings";

export function FocusScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const view = focusView(state);
  if (!view) return null;

  return (
    <div className="screen" data-testid="screen-focus">
      <OutcomePanel outcome={lastOutcome(state)} />
      <IntroPanel intro={sceneIntro(state)} />

      <section className="panel">
        <h2 className="title">{S.focusHeading}</h2>
        <p className="small" data-testid="term-account">
          {S.stipendArrived(view.stipend.requested.money, view.stipend.applied.money)} · {S.upkeepDue(view.upkeep)}
        </p>
        <p className={`small${view.efficiency.factor < 10 ? " warn" : " muted"}`} data-testid="efficiency-note">
          {view.efficiency.note}
        </p>
      </section>

      <div className="choice-list">
        {view.options.map((option) => (
          <button
            key={option.focus}
            type="button"
            className="choice"
            data-testid={`focus-${option.focus}`}
            onClick={() => dispatch({ type: "CHOOSE_FOCUS", focus: option.focus })}
          >
            <span className="choice-label">{option.name}</span>
            <DeltaLine delta={asDelta(option.requested, option.applied)} />
            {option.traitApplied ? <span className="tag">{S.traitTag}</span> : null}
            {option.efficiencyApplied ? <span className="tag warn">{S.efficiencyTag(view.efficiency.factor)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
