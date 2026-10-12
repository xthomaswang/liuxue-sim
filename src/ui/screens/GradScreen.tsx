// 毕业机会：揭晓前看资格与概率，揭晓后由玩家自己选去向；本科还会列出硕士方案（不可选的也显示原因）。

import { useGame } from "../../app/store";
import { graduationView, mastersOptions, routeOptions } from "../../engine";
import type { ActiveRun } from "../../engine";
import { FocusCountLine, OpportunityCard, StatLine } from "../components";
import { S } from "../strings";

export function GradScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const view = graduationView(state);
  if (!view) return null;
  const revealed = state.phase === "GRAD_RESULTS";
  const routes = revealed ? routeOptions(state) : [];
  const masters = revealed ? mastersOptions(state) : [];

  return (
    <div className="screen" data-testid={revealed ? "screen-grad-results" : "screen-grad-preview"}>
      <section className="panel">
        <div className="small">
          <span className="label">{S.frozenStats}</span>
          <StatLine stats={view.frozenStats} />
        </div>
        <div className="small">
          <span className="label">{S.focusCounts}</span>
          <FocusCountLine counts={view.frozenFocusCounts} />
        </div>
        {!revealed ? <p className="muted small">{S.gradPreviewLead}</p> : null}
      </section>

      <ul className="opportunity-list">
        {view.opportunities.map((opportunity) => (
          <OpportunityCard key={opportunity.id} view={opportunity} />
        ))}
      </ul>

      {!revealed ? (
        <button
          type="button"
          className="button primary wide"
          data-testid="reveal"
          onClick={() => dispatch({ type: "REVEAL_GRADUATION" })}
        >
          {S.reveal}
        </button>
      ) : null}

      {revealed ? (
        <section aria-label={S.routesHeading}>
          <h3 className="section-heading">{S.routesHeading}</h3>
          <p className="muted small">{S.routesNote}</p>
          <div className="choice-list">
            {routes.map((option) => (
              <button
                key={option.route}
                type="button"
                className="choice"
                disabled={!option.available}
                data-testid={`route-${option.route}`}
                onClick={() => dispatch({ type: "CHOOSE_ROUTE", route: option.route })}
              >
                <span className="choice-label">{option.name}</span>
                <span className="muted small block">{option.note}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {revealed && masters.length > 0 ? (
        <section aria-label={S.mastersHeading} data-testid="masters-section">
          <h3 className="section-heading">{S.mastersHeading}</h3>
          <p className="muted small">{S.mastersNote}</p>
          <div className="choice-list">
            {masters.map((option) => (
              <button
                key={option.program}
                type="button"
                className="choice"
                disabled={!option.eligible}
                data-testid={`masters-${option.program}`}
                onClick={() => dispatch({ type: "ENTER_MASTERS", program: option.program })}
              >
                <span className="choice-label">
                  {option.name}
                  <span className="muted small"> · {S.mastersTerms(option.terms)}</span>
                </span>
                <span className="small block">
                  {S.mastersBudget(option.fee, option.stipendTotal, option.upkeepTotal, option.requiredReserve, option.money)}
                </span>
                {option.eligible ? (
                  <span className="tag">{S.mastersPick}</span>
                ) : (
                  <span className="warn small block" data-testid={`masters-blockers-${option.program}`}>
                    {S.mastersBlocked}：{option.blockers.map((blocker) => blocker.text).join("；")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {revealed && state.stage === "MS" ? <p className="muted small">{S.mastersDone}</p> : null}
    </div>
  );
}
