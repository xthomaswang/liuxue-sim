// 留学人生图鉴（docs/14 第 5 节）：十档主线等级与十二个隐藏结局，本机累计。

import { useGame } from "../../app/store";
import { ENDING_CARDS } from "../../content";
import { S } from "../strings";

export function GalleryScreen(props: { onClose: () => void }) {
  const { gallery } = useGame();
  const tierCount = ENDING_CARDS.tiers.filter((tier) => gallery.tiers[tier.id]).length;
  const hiddenCount = ENDING_CARDS.hidden.filter((item) => gallery.hidden[item.id]).length;

  return (
    <div className="screen" data-testid="screen-gallery">
      <section className="panel">
        <h2 className="title">{S.galleryTitle}</h2>
        <p className="muted small">{S.galleryLead}</p>
        <p className="muted small">{ENDING_CARDS.disclaimer}</p>
        <button type="button" className="button" data-testid="close-gallery" onClick={props.onClose}>
          {S.galleryClose}
        </button>
      </section>

      <section aria-label={S.galleryTiers}>
        <h3 className="section-heading">
          {S.galleryTiers} <span className="muted small">{S.galleryProgress(tierCount, ENDING_CARDS.tiers.length)}</span>
        </h3>
        <ul className="gallery-list">
          {ENDING_CARDS.tiers.map((tier) => {
            const entry = gallery.tiers[tier.id];
            return (
              <li
                key={tier.id}
                className={`gallery-item${entry ? " unlocked" : " locked"}`}
                data-testid={`gallery-tier-${tier.id}`}
                data-unlocked={entry ? "true" : "false"}
              >
                <p className="card-tier">
                  <span className="tier-label">{tier.label}</span>
                  <span className="tier-kind">{tier.kind}</span>
                </p>
                <p className="card-name">{tier.name}</p>
                {entry ? (
                  <>
                    <p className="prose roast">{tier.roast}</p>
                    {tier.phdVariant ? (
                      <p className="small">
                        {tier.phdVariant.name}：<span className="roast">{tier.phdVariant.roast}</span>
                      </p>
                    ) : null}
                    <p className="muted small">
                      {S.galleryCondition}：{tier.condition}
                    </p>
                    <p className="muted small">{S.galleryCount(entry.count, entry.firstSeed)}</p>
                  </>
                ) : (
                  <p className="muted small">{S.galleryLocked}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label={S.galleryHidden}>
        <h3 className="section-heading">
          {S.galleryHidden}{" "}
          <span className="muted small">{S.galleryProgress(hiddenCount, ENDING_CARDS.hidden.length)}</span>
        </h3>
        <ul className="gallery-list">
          {ENDING_CARDS.hidden.map((item) => {
            const entry = gallery.hidden[item.id];
            return (
              <li
                key={item.id}
                className={`gallery-item${entry ? " unlocked" : " locked"}`}
                data-testid={`gallery-hidden-${item.id}`}
                data-unlocked={entry ? "true" : "false"}
              >
                <p className="card-name">
                  <span className="hidden-id">{item.id}</span> {entry ? item.name : S.galleryUnknown}
                </p>
                {entry ? (
                  <>
                    <p className="prose roast">{item.roast}</p>
                    <p className="muted small">
                      {S.galleryCondition}：{item.condition}
                    </p>
                    <p className="muted small">{S.galleryCount(entry.count, entry.firstSeed)}</p>
                  </>
                ) : (
                  <p className="muted small">{item.hint}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <button type="button" className="button wide" onClick={props.onClose}>
        {S.galleryClose}
      </button>
    </div>
  );
}
