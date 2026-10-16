// 图册（docs/22 第 7.3 节、docs/24 第 9 节）：一页看全部跨局进度——结局（含五年后）、成就、天赋。只是收藏册，不提供重抽、不联网。

import { useGame } from "../../app/store";
import { ACHIEVEMENTS, EARLY_ENDINGS, ENDING_CARDS, ENDING_FLAVORS, TALENTS } from "../../content";
import type { ProgressEntry } from "../../app/progress";
import { RarityTag } from "../components";
import { LIFE_TRACK_LIST } from "../lifeTracks";
import { RARITY_ORDER, S } from "../strings";

const JUMPS: ReadonlyArray<readonly [string, string]> = [
  ["gallery-endings", S.galleryEndings],
  ["gallery-outcomes", S.galleryOutcomes],
  ["gallery-achievements", S.galleryAchievements],
  ["gallery-talents", S.galleryTalents],
];

export function GalleryScreen(props: { onClose: () => void }) {
  const { progress } = useGame();
  const tierLabel = new Map(ENDING_CARDS.tiers.map((tier) => [tier.id, tier.label]));

  const talents = RARITY_ORDER.flatMap((rarity) => TALENTS.filter((talent) => talent.rarity === rarity));
  const talentOpen = (id: string, locked: boolean | undefined) => !locked || progress.unlockedTalents.includes(id);

  const count = (ids: string[], entries: Record<string, ProgressEntry>) => ids.filter((id) => entries[id]).length;
  const tierGot = count(ENDING_CARDS.tiers.map((tier) => tier.id), progress.tiers);
  const hiddenGot = count(ENDING_CARDS.hidden.map((item) => item.id), progress.hidden);
  const earlyGot = count(EARLY_ENDINGS.map((item) => item.id), progress.early);
  const flavorGot = count(ENDING_FLAVORS.map((item) => item.id), progress.flavors);
  const outcomeIds = LIFE_TRACK_LIST.flatMap((track) => track.outcomes.map((item) => item.id));
  const outcomeGot = count(outcomeIds, progress.outcomes);
  const endingGot = tierGot + hiddenGot + earlyGot + flavorGot + outcomeGot;
  const endingTotal =
    ENDING_CARDS.tiers.length + ENDING_CARDS.hidden.length + EARLY_ENDINGS.length + ENDING_FLAVORS.length + outcomeIds.length;
  const achievementGot = ACHIEVEMENTS.filter((item) => progress.achievements[item.id]).length;
  const talentGot = TALENTS.filter((talent) => talentOpen(talent.id, talent.locked)).length;

  // 图册很长：顶部给几块各一个跳转。
  const jump = (id: string) => {
    const target = document.getElementById(id);
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  };

  return (
    <div className="screen" data-testid="screen-gallery">
      <p className="lead" data-testid="gallery-progress">
        <span>
          {S.galleryProgress(
            S.fraction(achievementGot, ACHIEVEMENTS.length),
            S.fraction(talentGot, TALENTS.length),
            S.fraction(endingGot, endingTotal),
          )}
        </span>
        <button type="button" className="ghost-button" data-testid="close-gallery" onClick={props.onClose}>
          {S.galleryClose}
        </button>
      </p>

      <nav className="secondary" aria-label={S.galleryJump}>
        {JUMPS.map(([id, label]) => (
          <button key={id} type="button" className="link-button" data-testid={`jump-${id}`} onClick={() => jump(id)}>
            {label}
          </button>
        ))}
      </nav>

      <section id="gallery-endings" data-testid="gallery-endings">
        <h2 className="block-heading">{S.galleryEndings}</h2>
        <p className="muted small">{ENDING_CARDS.disclaimer}</p>

        <h3 className="section-heading">
          {S.galleryTiers}
          <span className="muted small">{S.fraction(tierGot, ENDING_CARDS.tiers.length)}</span>
        </h3>
        <ul className="gallery-list">
          {ENDING_CARDS.tiers.map((tier) => {
            const entry = progress.tiers[tier.id];
            return (
              <li key={tier.id} className={`gallery-item${entry ? "" : " locked"}`} data-testid={`gallery-tier-${tier.id}`} data-unlocked={entry ? "true" : "false"}>
                <p className="gallery-head">
                  <span className="tier-label">{tier.label}</span>
                  <span className="gallery-name">{tier.name}</span>
                </p>
                {entry ? (
                  <p className="muted small">
                    {tier.roast} · {S.galleryCount(entry.count, entry.firstSeed)}
                  </p>
                ) : (
                  <p className="muted small">{S.galleryLocked}</p>
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="section-heading">
          {S.galleryHidden}
          <span className="muted small">{S.fraction(hiddenGot, ENDING_CARDS.hidden.length)}</span>
        </h3>
        <ul className="gallery-list">
          {ENDING_CARDS.hidden.map((item) => {
            const entry = progress.hidden[item.id];
            return (
              <li key={item.id} className={`gallery-item compact${entry ? "" : " locked"}`} data-testid={`gallery-hidden-${item.id}`} data-unlocked={entry ? "true" : "false"}>
                <p className="gallery-head">
                  <span className="hidden-id">{item.id}</span>
                  <span className="gallery-name">{entry ? item.name : S.galleryUnknown}</span>
                </p>
                <p className="muted small">{entry ? `${item.roast} · ${S.galleryCount(entry.count, entry.firstSeed)}` : item.hint}</p>
              </li>
            );
          })}
        </ul>

        <h3 className="section-heading">
          {S.galleryEarly}
          <span className="muted small">{S.fraction(earlyGot, EARLY_ENDINGS.length)}</span>
        </h3>
        <ul className="gallery-list">
          {EARLY_ENDINGS.map((item) => {
            const entry = progress.early[item.id];
            return (
              <li key={item.id} className={`gallery-item compact${entry ? "" : " locked"}`} data-testid={`gallery-early-${item.id}`} data-unlocked={entry ? "true" : "false"}>
                <p className="gallery-head">
                  <span className="tier-label">{tierLabel.get(item.tier) ?? item.tier}</span>
                  <span className="gallery-name">{entry ? item.name : S.galleryUnknown}</span>
                </p>
                <p className="muted small">{entry ? `${item.roast} · ${S.galleryCount(entry.count, entry.firstSeed)}` : item.hint}</p>
              </li>
            );
          })}
        </ul>

        <h3 className="section-heading">
          {S.galleryFlavors}
          <span className="muted small">{S.fraction(flavorGot, ENDING_FLAVORS.length)}</span>
        </h3>
        <ul className="gallery-list">
          {ENDING_FLAVORS.map((item) => {
            const entry = progress.flavors[item.id];
            return (
              <li key={item.id} className={`gallery-item compact${entry ? "" : " locked"}`} data-testid={`gallery-flavor-${item.id}`} data-unlocked={entry ? "true" : "false"}>
                <p className="gallery-head">
                  <span className="gallery-name">{entry ? item.name : S.galleryUnknown}</span>
                </p>
                <p className="muted small">{entry ? `${item.roast} · ${S.galleryCount(entry.count, entry.firstSeed)}` : item.hint}</p>
              </li>
            );
          })}
        </ul>

        <h3 className="section-heading" id="gallery-outcomes">
          {S.galleryOutcomes}
          <span className="muted small">{S.fraction(outcomeGot, outcomeIds.length)}</span>
        </h3>
        {LIFE_TRACK_LIST.map((track) => {
          const got = count(track.outcomes.map((item) => item.id), progress.outcomes);
          return (
            <div key={track.track} className="gallery-group" data-testid={`gallery-track-${track.track}`}>
              <h4 className="group-heading">
                {track.name}
                <span className="muted small">{S.fraction(got, track.outcomes.length)}</span>
              </h4>
              <ul className="gallery-list">
                {track.outcomes.map((item) => {
                  const entry = progress.outcomes[item.id];
                  return (
                    <li
                      key={item.id}
                      className={`gallery-item compact${entry ? ` rarity-row-${item.grade}` : " locked"}`}
                      data-testid={`gallery-outcome-${item.id}`}
                      data-unlocked={entry ? "true" : "false"}
                    >
                      <p className="gallery-head">
                        <RarityTag rarity={item.grade} />
                        <span className="gallery-name">{entry ? item.name : S.galleryUnknown}</span>
                      </p>
                      <p className="muted small">{entry ? `${item.roast} · ${S.galleryCount(entry.count, entry.firstSeed)}` : item.hint}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section id="gallery-achievements" data-testid="gallery-achievements">
        <h2 className="block-heading">
          {S.galleryAchievements}
          <span className="muted small">{S.fraction(achievementGot, ACHIEVEMENTS.length)}</span>
        </h2>
        <ul className="gallery-list">
          {ACHIEVEMENTS.map((item) => {
            const got = progress.achievements[item.id];
            return (
              <li
                key={item.id}
                className={`gallery-item compact${got ? ` rarity-row-${item.grade}` : " locked"}`}
                data-testid={`gallery-achievement-${item.id}`}
                data-unlocked={got ? "true" : "false"}
              >
                <p className="gallery-head">
                  <RarityTag rarity={item.grade} />
                  <span className="gallery-name">{item.name}</span>
                  {got ? null : <span className="muted small">{S.galleryUnmet}</span>}
                </p>
                <p className="small">{item.text}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="gallery-talents" data-testid="gallery-talents">
        <h2 className="block-heading">
          {S.galleryTalents}
          <span className="muted small">{S.fraction(talentGot, TALENTS.length)}</span>
        </h2>
        <ul className="gallery-list">
          {talents.map((talent) => {
            const open = talentOpen(talent.id, talent.locked);
            return (
              <li
                key={talent.id}
                className={`gallery-item compact${open ? ` rarity-row-${talent.rarity}` : " locked"}`}
                data-testid={`gallery-talent-${talent.id}`}
                data-unlocked={open ? "true" : "false"}
              >
                <p className="gallery-head">
                  <RarityTag rarity={talent.rarity} />
                  <span className="gallery-name">{open ? talent.name : S.galleryLocked}</span>
                </p>
                {open ? <p className="small">{talent.text}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <button type="button" className="button big" onClick={props.onClose}>
        {S.galleryClose}
      </button>
    </div>
  );
}
