// 毕业机会：三路各占一行（概率或“准备尚不足”，揭晓后加结果），下面是“查看结果”或去向与硕士方案。
// 去向只列出能选的（取得的机会与过渡期）；没取得的原因已经写在上面那三行里。硕士方案不可选时仍显示并写明原因。

import { useGame } from "../../app/store";
import { graduationView, lastOutcome, mastersOptions, routeOptions, termLedger } from "../../engine";
import type { ActiveRun } from "../../engine";
import { OpportunityRow, OutcomeLine, SettlementLine, StatusBlock } from "../components";
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
      <StatusBlock>
        <OutcomeLine outcome={lastOutcome(state)} />
        {!revealed ? <SettlementLine ledger={termLedger(state)} final /> : null}
      </StatusBlock>

      <section className="describe">
        <p className="prose">{revealed ? S.gradResultsLead : S.gradPreviewLead}</p>
        <ul className="opportunity-list">
          {view.opportunities.map((opportunity) => (
            <OpportunityRow key={opportunity.id} view={opportunity} />
          ))}
        </ul>
      </section>

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
        <div className="choice-list">
          {routes
            .filter((option) => option.available)
            .map((option) => (
            <button
              key={option.route}
              type="button"
              className="choice"
              data-testid={`route-${option.route}`}
              onClick={() => dispatch({ type: "CHOOSE_ROUTE", route: option.route })}
            >
              <span className="choice-label">{option.name}</span>
              <span className="muted small">{option.note}</span>
            </button>
          ))}
        </div>
      ) : null}

      {revealed && masters.length > 0 ? (
        <section data-testid="masters-section" aria-label={S.mastersHeading}>
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
                <span className="small">{S.mastersBudget(option.fee, option.requiredReserve, option.money)}</span>
                {!option.eligible ? (
                  <span className="warn small" data-testid={`masters-blockers-${option.program}`}>
                    {S.mastersBlocked}
                    {option.blockers.map((blocker) => blocker.text).join("；")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {revealed && state.stage === "MS" ? <p className="muted small">{S.mastersDone}</p> : null}
    </div>
  );
}
