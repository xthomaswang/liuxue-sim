// 事件界面：高中、本科主线、支线、硕士共用。默认只显示短文，点选项立即结算。

import { useGame } from "../../app/store";
import { admissionPreview, currentEvent, lastOutcome, sceneIntro } from "../../engine";
import type { ActiveRun, ChoiceView } from "../../engine";
import { DeltaLine, Expandable, IntroPanel, OddsRow, OutcomePanel } from "../components";
import { S, STRATEGY_NAME } from "../strings";

export function EventScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const view = currentEvent(state);
  if (!view) return null;
  const outcome = lastOutcome(state);
  const intro = sceneIntro(state);
  const preview = state.stage === "HS" ? admissionPreview(state) : null;
  const { event } = view;

  return (
    <div className="screen" data-testid="screen-event" data-event-id={event.id}>
      <OutcomePanel outcome={outcome} />
      {/* 高中开场短文与 HS_01 的摘要是同一句开头，默认只留可展开的长旁白。 */}
      <IntroPanel intro={intro} hideShort />

      <section className="panel event">
        <p className="eyebrow">{view.kindLabel}</p>
        <h2 className="title">{event.title}</h2>
        <p className="prose" data-testid="event-summary">
          {event.summary}
        </p>
        {view.defaultCallback ? <p className="prose aside">{view.defaultCallback.shortText}</p> : null}
        {preview ? (
          <p className="readiness">
            <span>{S.readinessLabel(preview.readinessSoFar)}</span>
            <span className="muted small">（{S.readinessNote}）</span>
          </p>
        ) : null}
        <Expandable label={S.storyExpand} testId="expand-story">
          <p className="prose">{event.body}</p>
          {view.matchedCallbacks.map((callback) => (
            <p className="prose aside" key={callback.ifFlag}>
              {callback.text}
            </p>
          ))}
        </Expandable>
      </section>

      <section aria-label={S.choicesHeading}>
        <div className="choice-list">
          {view.choices.map((item) => (
            <ChoiceButton
              key={item.choice.id}
              item={item}
              onChoose={() => dispatch({ type: "CHOOSE_EVENT", eventId: event.id, choiceId: item.choice.id })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ChoiceButton(props: { item: ChoiceView; onChoose: () => void }) {
  const { item } = props;
  const { choice, projected, admission } = item;
  const cost = choice.effects.money < 0 ? -choice.effects.money : 0;
  return (
    <button
      type="button"
      className="choice"
      disabled={!item.available}
      data-testid={`choice-${choice.id}`}
      onClick={props.onChoose}
    >
      <span className="choice-label">{choice.label}</span>
      <DeltaLine delta={item.delta} />
      {cost > 0 ? <span className="tag">{S.cost(cost)}</span> : null}
      {item.shortBy ? (
        <span className="warn small block" data-testid={`short-${choice.id}`}>
          {S.shortBy(item.shortBy.need, item.shortBy.have)}
        </span>
      ) : null}
      {admission && admission.readinessBonus !== null ? (
        <span className="small block">
          {S.readinessBonus(admission.readinessBonus)}
          {admission.readinessAfter !== null ? `，${S.readinessAfter(admission.readinessAfter)}` : ""}
        </span>
      ) : null}
      {admission && admission.strategy !== null && admission.odds ? (
        <span className="small block">
          {S.strategyLine(STRATEGY_NAME[admission.strategy])}：
          <OddsRow odds={admission.odds} />
        </span>
      ) : null}
      {projected && item.available ? (
        <span className="muted small block">
          {S.projected(projected.moneyAfterUpkeep, projected.upkeep)}
          {projected.shortfall > 0 ? ` ${S.projectedShortfall(projected.shortfall)}` : ""}
        </span>
      ) : null}
    </button>
  );
}
