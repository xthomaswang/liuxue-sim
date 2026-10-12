// 人生回顾：默认短结局 + 结局卡；完整回顾、概率分解与达成依据都折叠，由玩家主动展开。

import { useRef, useState } from "react";
import { copyText } from "../../app/clipboard";
import { useGame } from "../../app/store";
import { ENDING_CARDS } from "../../content";
import { endingView, graduationView } from "../../engine";
import type { ActiveRun, EndingCard, EndingView, ReviewEntry } from "../../engine";
import { Expandable, FocusCountLine, OpportunityCard, StatLine } from "../components";
import { rollText } from "../format";
import { S } from "../strings";

export function EndingScreen(props: { state: ActiveRun; onOpenGallery: () => void }) {
  const { state } = props;
  const { restart } = useGame();
  const view = endingView(state);
  const [fullOpen, setFullOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");
  const fullRef = useRef<HTMLElement | null>(null);
  if (!view) return null;

  const lookBack = () => {
    setFullOpen(true);
    // 等展开后的内容进入文档再滚动；测试环境没有 scrollIntoView 时跳过。
    window.setTimeout(() => {
      const node = fullRef.current;
      if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start" });
    }, 0);
  };

  const copySeed = () => {
    void copyText(String(view.seed)).then((ok) => setCopyState(ok ? "ok" : "failed"));
  };

  return (
    <div className="screen" data-testid="screen-ending">
      <section className="panel ending-main">
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
      </section>

      <section aria-label={S.keyOpportunities}>
        <h3 className="section-heading">{S.keyOpportunities}</h3>
        <ul className="opportunity-list">
          {view.opportunities.map((opportunity) => (
            <OpportunityCard key={opportunity.id} view={opportunity} compact />
          ))}
        </ul>
      </section>

      <EndingCardPanel card={view.card} />

      <section className="panel" ref={fullRef} data-testid="full-review">
        <button
          type="button"
          className="link-button"
          aria-expanded={fullOpen}
          data-testid="toggle-full-review"
          onClick={() => setFullOpen((value) => !value)}
        >
          {fullOpen ? S.fullCollapse : S.fullExpand}
        </button>
        {fullOpen ? <FullReview state={state} view={view} /> : null}
      </section>

      <div className="actions">
        <button type="button" className="button" data-testid="look-back" onClick={lookBack}>
          {S.lookBack}
        </button>
        <button type="button" className="button primary" data-testid="play-again" onClick={() => restart()}>
          {S.playAgain}
        </button>
      </div>

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
        <div>
          <p className="label">{S.cardHiddenHeading}</p>
          <ul className="hidden-list">
            {card.hidden.map((item) => (
              <li key={item.id} data-testid={`card-hidden-${item.id}`}>
                <span className="hidden-id">{item.id}</span> {item.name}
                <span className="prose roast block">{item.roast}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="muted small">{ENDING_CARDS.disclaimer}</p>
      <Expandable label={S.cardFactsExpand} testId="expand-card-facts">
        <ul className="plain-list small">
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
            <li key={draw.key}>
              {S.cardDrawLine(draw.label, draw.probabilityPercent, rollText(draw.roll), draw.success)}
            </li>
          ))}
        </ul>
      </Expandable>
    </section>
  );
}

function FullReview(props: { state: ActiveRun; view: EndingView }) {
  const { state, view } = props;
  const { full } = view;
  const snapshot = graduationView(state, view.degree);
  return (
    <div className="full-review">
      <h3 className="title">{view.title}</h3>
      <p className="prose">{full.body}</p>

      <h4 className="section-heading">{S.sectionBridge}</h4>
      <p className="prose">{full.bridge}</p>

      <h4 className="section-heading">{S.sectionNow}</h4>
      <p className="prose">{full.wellbeing.text}</p>
      <p className="prose">{full.money.text}</p>

      <h4 className="section-heading">{S.sectionAspiration}</h4>
      <p className="prose">{full.aspiration}</p>

      <h4 className="section-heading">{S.sectionFamily}</h4>
      <p className="prose">{full.family}</p>

      <h4 className="section-heading">{S.sectionReview}</h4>
      <p className="prose">{full.applicationSummary}</p>
      <ol className="review-list">
        {full.review.map((entry) => (
          <ReviewItem key={entry.eventId} entry={entry} />
        ))}
      </ol>
      {full.arcRecaps.map((sentence, index) => (
        <p className="prose aside" key={index}>
          {sentence}
        </p>
      ))}
      <div className="small">
        <span className="label">{S.focusSummaryHeading}</span>
        <ul className="inline-list">
          {full.focusSummary.map((item) => (
            <li key={item.focus}>
              {item.name} {item.count}
            </li>
          ))}
        </ul>
      </div>

      <h4 className="section-heading">{S.sectionEpilogue}</h4>
      <p className="prose">{full.epilogue}</p>

      <h4 className="section-heading">{S.sectionBreakdown}</h4>
      {snapshot ? (
        <div className="small">
          <div>
            <span className="label">{S.frozenStats}</span>
            <StatLine stats={snapshot.frozenStats} />
          </div>
          <div>
            <span className="label">{S.focusCounts}</span>
            <FocusCountLine counts={snapshot.frozenFocusCounts} />
          </div>
        </div>
      ) : null}
      <p className="muted small">{S.breakdownPointer}</p>

      {full.undergradOpportunities ? (
        <div data-testid="undergrad-opportunities">
          <h4 className="section-heading">{S.sectionUndergrad}</h4>
          <p className="muted small">{S.undergradNote}</p>
          <ul className="opportunity-list">
            {full.undergradOpportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} view={opportunity} compact />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewItem(props: { entry: ReviewEntry }) {
  const { entry } = props;
  return (
    <li data-testid={`review-${entry.eventId}`}>
      <span className="muted small block">{entry.when}</span>
      <span className="review-title">{entry.title}</span>
      <span className="block">{S.youChose(entry.choiceLabel)}</span>
      <Expandable label={S.reviewExpand}>
        <p className="prose">{entry.result}</p>
      </Expandable>
    </li>
  );
}
