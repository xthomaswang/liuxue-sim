// 人生总结（docs/24 §8）：五年后 → 当年（去向结局或中途结局）→ 结局标题与结局卡 → 事实 → 本局收获、继承天赋、再次重开。

import { useState } from "react";
import { copyText } from "../../app/clipboard";
import { useGame } from "../../app/store";
import { ACHIEVEMENTS, ENDING_CARDS, TALENTS } from "../../content";
import { summaryView } from "../../engine";
import type { ActiveRun, EndingCard, RunRewards, SummaryView as SummaryViewData } from "../../engine";
import { RarityTag } from "../components";
import { rollText, schoolText } from "../format";
import { OUTCOME_LABEL, POINT_NAME, POINT_ORDER, S } from "../strings";

export function SummaryScreen(props: { state: ActiveRun; onOpenGallery: () => void }) {
  const store = useGame();
  const view = summaryView(props.state);
  if (!view) return null;
  return (
    <SummaryContent
      view={view}
      rewards={store.rewards}
      inherit={store.progress.inherit}
      onInherit={store.setInherit}
      onPlayAgain={() => store.startRun()}
      onOpenGallery={props.onOpenGallery}
    />
  );
}

/** 纯展示：总结页的全部内容。收获、继承与按钮的动作由外面传入。 */
export function SummaryContent(props: {
  view: SummaryViewData;
  rewards: RunRewards | null;
  inherit: string | null;
  onInherit: (id: string | null) => void;
  onPlayAgain: () => void;
  onOpenGallery: () => void;
}) {
  const { view, rewards, inherit } = props;
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");

  const copySeed = () => {
    void copyText(String(view.seed)).then((ok) => setCopyState(ok ? "ok" : "failed"));
  };

  const newAchievements = rewards ? ACHIEVEMENTS.filter((item) => rewards.achievements.includes(item.id)) : [];
  const newTalent = rewards?.unlockedTalent ? TALENTS.find((talent) => talent.id === rewards.unlockedTalent) : undefined;
  // life 与 gpa 是第四版加的；缺省（或经典模式为 null）时按第三版的样子显示。
  const life = view.life ?? null;
  const gpa = typeof view.gpa === "number" ? view.gpa : null;

  return (
    <div className="screen" data-testid="screen-summary">
      {life ? (
        <section className="life" data-testid="life-block" data-outcome={life.outcome.id} data-grade={life.outcome.grade}>
          <p className="eyebrow">
            {S.lifeHeading} · <span data-testid="life-age">{S.ageLabel(life.age)}</span>
          </p>
          <h2 className="life-name">
            <RarityTag rarity={life.outcome.grade} />
            <span data-testid="life-outcome">{life.outcome.name}</span>
          </h2>
          <p className="roast">{life.outcome.roast}</p>
          <p className="prose">{life.outcome.text}</p>
          <p className="muted small" data-testid="life-path">
            {S.lifePath(life.trackNames)}
          </p>
        </section>
      ) : null}

      {view.card.flavor ? (
        <section className={`flavor${life ? " then" : ""}`} data-flavor={view.card.flavor.id}>
          <p className="eyebrow">{life ? S.flavorLeadThen : S.flavorLead}</p>
          <h2 className="flavor-name" data-testid="ending-flavor">
            {view.card.flavor.name}
          </h2>
          <p className="roast">{view.card.flavor.roast}</p>
          <p className="prose">{view.card.flavor.text}</p>
        </section>
      ) : view.card.early ? (
        <section className={`flavor${life ? " then" : ""}`} data-early={view.card.early}>
          {life ? <p className="eyebrow">{S.earlyLeadThen}</p> : null}
          <h2 className="flavor-name" data-testid="ending-early">
            {view.card.name}
          </h2>
          <p className="roast">{view.card.roast}</p>
        </section>
      ) : null}

      <section className="describe">
        <p className="tags">
          <span className="tag" data-testid="ending-label">
            {view.label}
          </span>
        </p>
        <h2 className="title" data-testid="ending-title">
          {view.title}
        </h2>
        <p className="prose" data-testid="ending-text">
          {view.text}
        </p>
        {view.keyExperience ? <p className="prose">{view.keyExperience}</p> : null}
      </section>

      <EndingCardPanel card={view.card} />

      {/* 有毕业后的五年时，原来那段“五年后”的文字由上面的五年后结局代替。 */}
      {life ? null : (
        <section className="describe">
          <h3 className="section-heading">{S.epilogueHeading}</h3>
          <p className="prose" data-testid="ending-epilogue">
            {view.epilogue}
          </p>
        </section>
      )}

      <section className="facts" data-testid="summary-facts">
        <p>
          <span className="label">{life ? S.lifeHeading : S.finalStats}</span>
          <span className="inline-list">
            {view.stats.map((item) => (
              <span key={item.key} data-testid={`final-${item.key}`}>
                {item.name} {item.value} <span className="muted">{item.rating}</span>
              </span>
            ))}
          </span>
        </p>
        {life ? (
          <p data-testid="start-stats">
            <span className="label">{S.startStats}</span>
            <span className="inline-list">
              {life.startStats.map((item) => (
                <span key={item.key}>
                  {item.name} {item.value} <span className="muted">{item.rating}</span>
                </span>
              ))}
            </span>
          </p>
        ) : null}
        {gpa !== null ? (
          <p data-testid="summary-gpa">
            <span className="label">{S.gpaLabel}</span>
            {gpa.toFixed(2)}
          </p>
        ) : null}
        {view.school ? (
          <p>
            <span className="label">{S.schoolPrefix}</span>
            {schoolText(view.school)}
          </p>
        ) : null}
        <p data-testid="summary-talents">
          <span className="label">{S.talentsHeading}</span>
          <span className="inline-list">
            {view.talents.map((talent) => (
              <span key={talent.id}>
                <RarityTag rarity={talent.rarity} /> {talent.name}
              </span>
            ))}
          </span>
        </p>
        {view.points ? (
          <p>
            <span className="label">{S.pointsHeading}</span>
            <span className="inline-list">
              {POINT_ORDER.map((key) => (
                <span key={key}>
                  {POINT_NAME[key]} {view.points?.[key]}
                </span>
              ))}
            </span>
          </p>
        ) : null}
        {view.opportunities.length > 0 ? (
          <ul className="opportunity-list" aria-label={S.opportunitiesHeading}>
            {view.opportunities.map((item) => (
              <li key={item.id} className="opportunity" data-testid={`opportunity-${item.id}`}>
                <span className="opportunity-name">{item.name}</span>
                {item.outcome ? <span className={`opportunity-outcome ${item.outcome.toLowerCase()}`}>{OUTCOME_LABEL[item.outcome]}</span> : null}
                {item.eligible && item.probability !== null ? (
                  <span className="muted">{S.probability(item.probability)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel" data-testid="rewards">
        <h3 className="section-heading">{S.rewardsHeading}</h3>
        {newTalent ? (
          <p className={`reward-talent rarity-row-${newTalent.rarity}`} data-testid="reward-talent" data-talent={newTalent.id}>
            <strong>{S.rewardTalent(newTalent.name, newTalent.rarity)}</strong>
            <span className="small">{newTalent.text}</span>
          </p>
        ) : null}
        {newAchievements.map((item) => (
          <p key={item.id} className="reward-achievement" data-testid={`reward-achievement-${item.id}`}>
            <RarityTag rarity={item.grade} /> <strong>{item.name}</strong>
            <span className="muted small"> {item.text}</span>
          </p>
        ))}
        {!newTalent && newAchievements.length === 0 ? <p className="muted small">{S.rewardsNone}</p> : null}
      </section>

      <section className="describe" data-testid="inherit">
        <h3 className="section-heading">{S.inheritHeading}</h3>
        <div className="talent-list">
          {view.talents.map((talent) => {
            const selected = inherit === talent.id;
            return (
              <button
                key={talent.id}
                type="button"
                className={`talent-row compact rarity-row-${talent.rarity}${selected ? " selected" : ""}`}
                aria-pressed={selected}
                data-testid={`inherit-${talent.id}`}
                onClick={() => props.onInherit(selected ? null : talent.id)}
              >
                <span className="talent-head">
                  <RarityTag rarity={talent.rarity} />
                  <span className="talent-name">{talent.name}</span>
                  <span className="talent-check">{selected ? S.inheritChosen : ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <button type="button" className="button primary big" data-testid="play-again" onClick={props.onPlayAgain}>
        {S.playAgain}
      </button>

      <div className="secondary">
        <button type="button" className="link-button" data-testid="open-gallery" onClick={props.onOpenGallery}>
          {S.galleryOpen}
        </button>
        <button type="button" className="link-button" data-testid="copy-seed" onClick={copySeed}>
          {S.copySeed}
        </button>
        <span className="muted small" data-testid="seed-line">
          {S.seedLine(view.seed)}
          {copyState === "ok" ? ` · ${S.copied}` : copyState === "failed" ? ` · ${S.copyFailed}` : ""}
        </span>
      </div>
    </div>
  );
}

function EndingCardPanel(props: { card: EndingCard }) {
  const { card } = props;
  return (
    <section className="panel ending-card" data-testid="ending-card" data-tier={card.tier} data-early={card.early ?? undefined}>
      <p className="eyebrow">{S.cardHeading}</p>
      <p className="card-tier">
        <span className="tier-label" data-testid="card-tier">
          {card.tierLabel}
        </span>
        <span className="tier-kind">{card.tierKind}</span>
      </p>
      <h3 className="card-name">{card.name}</h3>
      <p className="prose roast">{card.roast}</p>
      <p className="combo" data-testid="card-combo">
        {card.combo}
      </p>
      {card.hidden.length > 0 ? (
        <ul className="hidden-list">
          {card.hidden.map((item) => (
            <li key={item.id} data-testid={`card-hidden-${item.id}`}>
              <span className="hidden-id">{item.id}</span> {item.name}
              <span className="roast"> · {item.roast}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="muted small" data-testid="card-facts">
        {card.facts.map((fact, index) => (
          <li key={index}>{fact}</li>
        ))}
        {card.hidden.flatMap((item) =>
          item.facts.map((fact, index) => (
            <li key={`${item.id}-${index}`}>
              {item.id}：{fact}
            </li>
          )),
        )}
        {card.draws.map((draw) => (
          <li key={draw.key}>{S.cardDrawLine(draw.label, draw.probabilityPercent, rollText(draw.roll), draw.success)}</li>
        ))}
      </ul>
      <p className="muted small">{ENDING_CARDS.disclaimer}</p>
    </section>
  );
}
