// 选安排一屏：上面是几行状态（上一步、上学期结算、本学期资助、突发小事），下面是这学期的四个安排。

import { useGame } from "../../app/store";
import { focusView, lastOutcome, sceneIntro, termLedger } from "../../engine";
import type { ActiveRun } from "../../engine";
import { DeltaLine, OutcomeLine, SettlementLine, StatusBlock, StatusLine } from "../components";
import { asDelta } from "../format";
import { FOCUS_SHORT, S } from "../strings";

export function FocusScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const view = focusView(state);
  if (!view) return null;
  const intro = sceneIntro(state);

  return (
    <div className="screen" data-testid="screen-focus">
      <StatusBlock>
        <OutcomeLine outcome={lastOutcome(state)} />
        <SettlementLine ledger={termLedger(state)} />
        <StatusLine label={S.statusTerm} testId="term-account">
          {S.stipendLine(view.stipend.requested.money, view.stipend.applied.money)} · {S.upkeepDue(view.upkeep)}
        </StatusLine>
        {view.happening ? (
          <StatusLine label={S.statusHappening} testId="happening">
            {view.happening.text} <DeltaLine delta={view.happening.delta} />
          </StatusLine>
        ) : null}
        {view.efficiency.factor < 10 ? (
          <StatusLine label={S.statusEfficiency} testId="efficiency-note" warn>
            {view.efficiency.note}
          </StatusLine>
        ) : null}
      </StatusBlock>

      <section className="describe">
        {intro ? (
          <p className="prose" data-testid="scene-intro">
            {intro.short}
          </p>
        ) : null}
        <h2 className="title">{S.planHeading}</h2>
      </section>

      <div className="choice-list">
        {view.options.map((option) => (
          <button
            key={option.plan.id}
            type="button"
            className="choice"
            disabled={!option.available}
            data-testid={`plan-${option.plan.id}`}
            data-focus={option.focus}
            onClick={() => dispatch({ type: "CHOOSE_PLAN", planId: option.plan.id })}
          >
            <span className="choice-label">
              <span className="plan-kind">{FOCUS_SHORT[option.focus]}</span>
              {option.name}
            </span>
            <span className="chips">
              <DeltaLine delta={asDelta(option.requested, option.applied)} />
              {option.talentApplied ? <span className="tag">{S.talentTag}</span> : null}
              {option.efficiencyApplied ? <span className="tag warn">{S.efficiencyTag(view.efficiency.factor)}</span> : null}
            </span>
            {option.shortBy ? (
              <span className="warn small" data-testid={`short-${option.plan.id}`}>
                {S.insufficient(option.shortBy.need, option.shortBy.have)}
              </span>
            ) : null}
            {option.available && option.projectedShortfall > 0 ? (
              <span className="warn small">{S.shortfallWarning(option.projectedShortfall)}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
