// 事件一屏：上面是类别、标题、摘要，下面两个选项。高中、主线、支线、随机事件、硕士共用。

import { useGame } from "../../app/store";
import { admissionPreview, currentEvent, lastOutcome } from "../../engine";
import type { ActiveRun, ChoiceView } from "../../engine";
import { DeltaLine, OddsRow, OutcomeLine, StatusBlock } from "../components";
import { S } from "../strings";

export function EventScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const view = currentEvent(state);
  if (!view) return null;
  const preview = state.stage === "HS" ? admissionPreview(state) : null;
  const { event } = view;

  return (
    <div className="screen" data-testid="screen-event" data-event-id={event.id}>
      <StatusBlock>
        <OutcomeLine outcome={lastOutcome(state)} />
      </StatusBlock>

      <section className="describe">
        <p className="eyebrow">{view.kindLabel}</p>
        <h2 className="title">{event.title}</h2>
        <p className="prose" data-testid="event-summary">
          {event.summary}
        </p>
        {view.defaultCallback ? <p className="prose aside">{view.defaultCallback.shortText}</p> : null}
        {preview ? <p className="small">{S.readinessLabel(preview.readinessSoFar)}</p> : null}
      </section>

      <div className="choice-list">
        {view.choices.map((item) => (
          <ChoiceButton
            key={item.choice.id}
            item={item}
            onChoose={() => dispatch({ type: "CHOOSE_EVENT", eventId: event.id, choiceId: item.choice.id })}
          />
        ))}
      </div>
    </div>
  );
}

function ChoiceButton(props: { item: ChoiceView; onChoose: () => void }) {
  const { item } = props;
  const { choice, projected, admission } = item;
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
      {admission && admission.readinessBonus !== null ? (
        <span className="tag">{S.readinessBonus(admission.readinessBonus)}</span>
      ) : null}
      {admission && admission.strategy !== null && admission.odds ? <OddsRow odds={admission.odds} /> : null}
      {item.shortBy ? (
        <span className="warn small" data-testid={`short-${choice.id}`}>
          {S.insufficient(item.shortBy.need, item.shortBy.have)}
        </span>
      ) : null}
      {item.available && projected && projected.shortfall > 0 ? (
        <span className="warn small">{S.shortfallWarning(projected.shortfall)}</span>
      ) : null}
    </button>
  );
}
