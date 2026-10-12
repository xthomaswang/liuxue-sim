// 申请结果与同档三校 offer。只能在这三所里选一所；没有搜索，也没有自由选校。

import { useGame } from "../../app/store";
import { admissionResult, lastOutcome } from "../../engine";
import type { ActiveRun } from "../../engine";
import { OddsRow, OutcomePanel } from "../components";
import { schoolPlace, schoolTitle, tierBasisText } from "../format";
import { S, STRATEGY_NAME, TIER_NAME } from "../strings";

export function OffersScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const result = admissionResult(state);
  if (!result) return null;

  return (
    <div className="screen" data-testid="screen-offers">
      <OutcomePanel outcome={lastOutcome(state)} />

      <section className="panel">
        <h2 className="title">{S.admissionHeading}</h2>
        <p className="prose">
          {S.readinessFinal(result.readiness, result.baseReadiness, result.readinessBonus)} ·{" "}
          {S.strategyChosen(STRATEGY_NAME[result.strategy])}
        </p>
        <p className="small">
          {S.oddsHeading}：<OddsRow odds={result.odds} />
        </p>
        <p className="tier-drawn" data-testid="tier-drawn">
          {S.tierDrawn(TIER_NAME[result.tier])}
        </p>
        <p className="muted small">
          {S.tierDrawNote}
          {result.tier === "U" ? S.tierUNote : ""}
        </p>
      </section>

      <section aria-label={S.offersHeading}>
        <h3 className="section-heading">{S.offersHeading}</h3>
        <div className="choice-list">
          {result.offers.map((school, index) => (
            <button
              key={school.unitid}
              type="button"
              className="choice school"
              data-testid={`offer-${index}`}
              data-unitid={school.unitid}
              onClick={() => dispatch({ type: "CHOOSE_SCHOOL", unitid: school.unitid })}
            >
              <span className="choice-label">{schoolTitle(school)}</span>
              {school.nameZh ? <span className="muted small block">{school.name}</span> : null}
              <span className="small block">
                {schoolPlace(school)} · {TIER_NAME[school.tier]}
              </span>
              <span className="muted small block">{tierBasisText(school)}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{S.offersNote}</p>
      </section>
    </div>
  );
}
