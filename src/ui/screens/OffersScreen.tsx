// 申请结果一屏：一行结果、一行各档概率，下面三张同档学校卡。没有搜索，也没有自由选校。

import { useGame } from "../../app/store";
import { admissionResult, lastOutcome } from "../../engine";
import type { ActiveRun } from "../../engine";
import { OddsRow, OutcomeLine, StatusBlock } from "../components";
import { schoolPlace, schoolTitle, tierBasisText } from "../format";
import { S, STRATEGY_NAME, TIER_NAME } from "../strings";

export function OffersScreen(props: { state: ActiveRun }) {
  const { state } = props;
  const { dispatch } = useGame();
  const result = admissionResult(state);
  if (!result) return null;

  return (
    <div className="screen" data-testid="screen-offers">
      <StatusBlock>
        <OutcomeLine outcome={lastOutcome(state)} />
      </StatusBlock>

      <section className="describe">
        <h2 className="title">{S.offersHeading}</h2>
        <p className="small" data-testid="tier-drawn">
          {S.admissionLine(
            result.readiness,
            result.baseReadiness,
            result.talentBonus,
            result.readinessBonus,
            STRATEGY_NAME[result.strategy],
            TIER_NAME[result.tier],
          )}
        </p>
        <p className="small">
          <OddsRow odds={result.odds} />
        </p>
        <p className="muted small">
          {S.offersNote}
          {result.tier === "U" ? S.tierUNote : ""}
        </p>
      </section>

      <div className="choice-list">
        {result.offers.map((school, index) => (
          <button
            key={school.unitid}
            type="button"
            className="choice"
            data-testid={`offer-${index}`}
            data-unitid={school.unitid}
            onClick={() => dispatch({ type: "CHOOSE_SCHOOL", unitid: school.unitid })}
          >
            <span className="choice-label">{schoolTitle(school)}</span>
            {school.nameZh ? <span className="muted small">{school.name}</span> : null}
            <span className="small">
              {schoolPlace(school)} · {TIER_NAME[school.tier]}
            </span>
            <span className="muted small">{tierBasisText(school)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
