// 人生回顾：短结局、三路机会结果、结局卡、本局天赋、五年后一段。唯一的展开是“回看这次经历”。

import { useState } from "react";
import { copyText } from "../../app/clipboard";
import { useGame } from "../../app/store";
import { ENDING_CARDS } from "../../content";
import { endingView } from "../../engine";
import type { ActiveRun, EndingCard, EndingView } from "../../engine";
import { OpportunityRow, RarityTag } from "../components";
import { rollText } from "../format";
import { S } from "../strings";

export function EndingScreen(props: { state: ActiveRun; onOpenGallery: () => void }) {
  const { restart } = useGame();
  const view = endingView(props.state);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");
  if (!view) return null;

  const copySeed = () => {
    void copyText(String(view.seed)).then((ok) => setCopyState(ok ? "ok" : "failed"));
  };

  return (
    <div className="screen" data-testid="screen-ending">
      <section className="describe">
        <p className="tags">
          <span className="tag" data-testid="ending-label">
            {view.label}
          </span>
          {view.labelExtra ? <span className="tag">{view.labelExtra}</span> : null}
        </p>
        <h2 className="title" data-testid="ending-title">
          {view.title}
        </h2>
        <p className="prose" data-testid="ending-short">
          {view.short.text}
        </p>
        <p className="prose">{view.short.keyExperience}</p>
        <p className="prose">{view.short.status}</p>
        <ul className="opportunity-list" aria-label={S.opportunitiesHeading}>
          {view.opportunities.map((opportunity) => (
            <OpportunityRow key={opportunity.id} view={opportunity} bare />
          ))}
        </ul>
      </section>

      <EndingCardPanel card={view.card} />

      <section className="describe">
        <p className="small" data-testid="ending-talents">
          <span className="status-label">{S.talentsHeading}</span>
          <span className="inline-list">
            {view.talents.map((talent) => (
              <span key={talent.id}>
                <RarityTag rarity={talent.rarity} /> {talent.name}
              </span>
            ))}
          </span>
        </p>
        <h3 className="section-heading">{S.epilogueHeading}</h3>
        <p className="prose" data-testid="ending-epilogue">
          {view.full.epilogue}
        </p>
      </section>

      <div className="actions">
        <button
          type="button"
          className="button"
          aria-expanded={reviewOpen}
          data-testid="look-back"
          onClick={() => setReviewOpen((value) => !value)}
        >
          {reviewOpen ? S.lookBackClose : S.lookBack}
        </button>
        <button type="button" className="button primary" data-testid="play-again" onClick={() => restart()}>
          {S.playAgain}
        </button>
      </div>

      {reviewOpen ? <Review view={view} /> : null}

      <section className="secondary">
        <p className="muted small" data-testid="seed-line">
          {S.seedLine(view.seed)}
          {copyState === "ok" ? ` · ${S.copied}` : copyState === "failed" ? ` · ${S.copyFailed}` : ""}
        </p>
        <button type="button" className="link-button" data-testid="copy-seed" onClick={copySeed}>
          {S.copySeed}
        </button>
        <button type="button" className="link-button" data-testid="replay-seed" onClick={() => restart(view.seed)}>
          {S.replaySeed}
        </button>
        <button type="button" className="link-button" data-testid="open-gallery" onClick={props.onOpenGallery}>
          {S.galleryOpen}
        </button>
      </section>
    </div>
  );
}

function EndingCardPanel(props: { card: EndingCard }) {
  const { card } = props;
  return (
    <section className="panel ending-card" data-testid="ending-card" data-tier={card.tier}>
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
      <ul className="plain-list muted small" data-testid="card-facts">
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

/** “回看这次经历”：只列各节点的标题与当时的选择，不逐条展开长文。 */
function Review(props: { view: EndingView }) {
  const { full } = props.view;
  return (
    <section className="describe" data-testid="full-review">
      <p className="small">{full.applicationSummary}</p>
      <ol className="review-list">
        {full.review.map((entry) => (
          <li key={entry.eventId} data-testid={`review-${entry.eventId}`}>
            <span className="muted small">{entry.when}</span>
            <span className="review-title">{entry.title}</span>
            <span className="small">{S.youChose(entry.choiceLabel)}</span>
          </li>
        ))}
      </ol>
      <p className="small">
        <span className="status-label">{S.focusSummaryHeading}</span>
        <span className="inline-list">
          {full.focusSummary.map((item) => (
            <span key={item.focus}>
              {item.name} {item.count}
            </span>
          ))}
        </span>
      </p>
      <p className="prose">{full.aspiration}</p>
      <p className="prose">{full.family}</p>
    </section>
  );
}
