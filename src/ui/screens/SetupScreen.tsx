// 开局：三张家庭档案、个人愿望、可选的名字。选择只存在本组件里，点“开始”才交给引擎。

import { useMemo, useState } from "react";
import { useGame } from "../../app/store";
import { parseSeed } from "../../app/seed";
import { TEXTS } from "../../content";
import { admissionPreview, familyCandidates } from "../../engine";
import type { Aspiration, Economy, SetupRun } from "../../engine";
import { Expandable, StatLine } from "../components";
import { APP_TITLE, ECONOMY_NOTE, S, TRAIT_RULE } from "../strings";

const ASPIRATIONS: Aspiration[] = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
const NAME_LIMIT = 12;

export function SetupScreen(props: { state: SetupRun; onOpenGallery: () => void }) {
  const { state } = props;
  const { dispatch, restart } = useGame();
  const candidates = useMemo(() => familyCandidates(state.seed), [state.seed]);
  const preview = useMemo(() => admissionPreview(state), [state]);
  const [economy, setEconomy] = useState<Economy | null>(null);
  const [aspiration, setAspiration] = useState<Aspiration | null>(null);
  const [name, setName] = useState("");
  const [seedText, setSeedText] = useState("");
  const [seedError, setSeedError] = useState(false);

  const ready = economy !== null && aspiration !== null;

  const start = () => {
    if (economy === null || aspiration === null) return;
    dispatch({
      type: "CONFIRM_SETUP",
      economy,
      aspiration,
      name: Array.from(name.trim()).slice(0, NAME_LIMIT).join(""),
    });
  };

  const applySeed = () => {
    const seed = parseSeed(seedText);
    if (seed === null) {
      setSeedError(true);
      return;
    }
    setSeedError(false);
    restart(seed);
  };

  return (
    <div className="screen" data-testid="screen-setup">
      <section className="panel">
        <h2 className="title">{APP_TITLE}</h2>
        <p className="prose">{S.setupLead}</p>
        <p className="readiness">
          <span data-testid="base-readiness">{S.readinessLabel(preview.baseReadiness)}</span>
          <span className="muted small">（{S.readinessNote}）</span>
        </p>
      </section>

      <section aria-label={S.familyHeading}>
        <h3 className="section-heading">{S.familyHeading}</h3>
        <p className="muted small">{S.setupEconomyNote}</p>
        <div className="card-list" role="radiogroup" aria-label={S.familyHeading}>
          {candidates.map((family) => {
            const selected = economy === family.economy;
            const eco = TEXTS.economy[family.economy];
            const exp = TEXTS.expectation[family.expectation];
            const trait = TEXTS.trait[family.trait];
            return (
              <article
                key={family.economy}
                className={`card family${selected ? " selected" : ""}`}
                data-testid={`family-card-${family.economy}`}
              >
                <h4 className="card-title">
                  {eco.cardName} · {exp.cardName}
                </h4>
                <p className="prose">
                  {eco.cardText}
                  {exp.cardText}
                </p>
                <p className="small">
                  <span className="label">{S.traitLabel}</span>
                  {trait.name}（{trait.tagline}）：{TRAIT_RULE[family.trait]}
                </p>
                <div className="small">
                  <span className="label">{S.initialStats}</span>
                  <StatLine stats={family.initialStats} />
                </div>
                <p className="muted small">
                  {S.stipendLine(family.stipend, family.upkeep)}。{ECONOMY_NOTE[family.economy]}
                </p>
                <Expandable label={S.familyDetails} testId={`family-details-${family.economy}`}>
                  <p className="prose">{eco.detail}</p>
                  <p className="prose">{exp.detail}</p>
                </Expandable>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`button${selected ? " primary" : ""}`}
                  data-testid={`family-${family.economy}`}
                  onClick={() => setEconomy(family.economy)}
                >
                  {selected ? S.familySelected : S.familySelect}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {economy !== null ? (
        <section aria-label={S.aspirationHeading}>
          <h3 className="section-heading">{S.aspirationHeading}</h3>
          <p className="muted small">{S.aspirationNote}</p>
          <div className="choice-list" role="radiogroup" aria-label={S.aspirationHeading}>
            {ASPIRATIONS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={aspiration === id}
                className={`choice${aspiration === id ? " selected" : ""}`}
                data-testid={`aspiration-${id}`}
                onClick={() => setAspiration(id)}
              >
                <span className="choice-label">{TEXTS.aspiration[id].choice}</span>
              </button>
            ))}
          </div>
          {aspiration !== null ? <p className="prose aside">{TEXTS.aspiration[aspiration].response}</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <label className="field">
          <span className="label">{S.nameLabel}</span>
          <input
            type="text"
            value={name}
            maxLength={NAME_LIMIT}
            placeholder={S.namePlaceholder}
            autoComplete="off"
            data-testid="name-input"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="button" className="button primary wide" disabled={!ready} data-testid="start" onClick={start}>
          {S.start}
        </button>
        {!ready ? <p className="muted small">{S.startHint}</p> : null}
      </section>

      <section className="secondary">
        <button type="button" className="link-button" data-testid="open-gallery" onClick={props.onOpenGallery}>
          {S.galleryOpen}
        </button>
        <Expandable label={S.seedToggle} testId="seed-toggle">
          <p className="muted small">
            {S.seedCurrent(state.seed)}。{S.seedNote}
          </p>
          <label className="field">
            <span className="label">{S.seedInputLabel}</span>
            <input
              type="text"
              inputMode="numeric"
              value={seedText}
              autoComplete="off"
              data-testid="seed-input"
              onChange={(event) => setSeedText(event.target.value)}
            />
          </label>
          {seedError ? (
            <p className="warn small" role="alert">
              {S.seedInvalid}
            </p>
          ) : null}
          <button type="button" className="button" data-testid="seed-apply" onClick={applySeed}>
            {S.seedApply}
          </button>
        </Expandable>
      </section>
    </div>
  );
}
