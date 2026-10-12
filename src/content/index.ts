// 静态内容的唯一入口。JSON 由 scripts/extract-content.ts（事件与文案）和 scripts/schools（学校目录）生成，
// endingCards.json 为手写（见 docs/14）。运行时不解析 Markdown。

import type {
  Aspiration,
  Economy,
  EducationPath,
  EndingStatusId,
  EndingTierId,
  Expectation,
  FinalRoute,
  Focus,
  HiddenEndingId,
  MastersProgram,
  MoneyBand,
  RuntimeCatalog,
  StatKey,
  StoryEvent,
  Trait,
  WellbeingBand,
} from "../engine/types";
import endingCardsJson from "./endingCards.json";
import arcsJson from "./events/arcs.json";
import coreJson from "./events/core.json";
import highschoolJson from "./events/highschool.json";
import mastersJson from "./events/masters.json";
import catalogJson from "./schools/catalog.runtime.json";
import textsJson from "./texts.json";

export type RouteVariantKey =
  | "PHD/undergrad_direct"
  | "PHD/masters_entry"
  | "LOCAL_JOB"
  | "HOME_JOB"
  | "TRANSITION/SELF_CHOSEN"
  | "TRANSITION/NO_OFFER";
export type ShortEndingKey = "PHD/ANY" | "LOCAL_JOB" | "HOME_JOB" | "TRANSITION/SELF_CHOSEN" | "TRANSITION/NO_OFFER";
export type FamilyRouteGroup = "RESEARCH" | "WORK" | "PAUSE";

export interface Texts {
  economy: Record<Economy, { cardText: string; cardName: string; detail: string; shortName: string }>;
  expectation: Record<Expectation, { cardText: string; cardName: string; detail: string; hopes: string }>;
  trait: Record<Trait, { name: string; tagline: string }>;
  aspiration: Record<Aspiration, { choice: string; response: string }>;
  stat: Record<StatKey, { name: string; meaning: string }>;
  focus: Record<Focus, { name: string }>;
  /** 键为效率的十分数："10" / "8" / "6"。 */
  efficiency: Record<"10" | "8" | "6", string>;
  mastersProgram: Record<MastersProgram, { name: string }>;
  narration: {
    highSchoolShort: string;
    highSchoolLong: string;
    /** 含 {{school.name}}。 */
    enrollmentShort: string;
    /** 含 {{school.name}} 与 {{school.city}}。 */
    enrollmentLong: string;
  };
  /** 键为支线第三幕的标记，如 ARC_RESEARCH_3_A。 */
  arcRecap: Record<string, string>;
  ending: {
    short: Record<ShortEndingKey, string>;
    stateShort: Record<WellbeingBand | MoneyBand, string>;
    route: Record<RouteVariantKey, { title: string; body: string }>;
    /** UG 一项含 {schoolName}。 */
    bridge: Record<EducationPath, string>;
    wellbeingState: Record<WellbeingBand, string>;
    moneyState: Record<MoneyBand, string>;
    aspirationResponse: Record<Aspiration, Record<FinalRoute, string>>;
    familyResponse: Record<Expectation, Record<FamilyRouteGroup, string>>;
    epilogue: Record<RouteVariantKey, string>;
  };
}

export interface EndingTierContent {
  id: EndingTierId;
  label: string;
  kind: string;
  name: string;
  roast: string;
  condition: string;
  phdVariant?: { name: string; roast: string };
}
export interface HiddenEndingContent {
  id: HiddenEndingId;
  name: string;
  roast: string;
  condition: string;
  hint: string;
}
export interface EndingCardsContent {
  disclaimer: string;
  /** 固定顺序 EX → BE。 */
  tiers: EndingTierContent[];
  /** 固定顺序 H01 → H12。 */
  hidden: HiddenEndingContent[];
  status: Record<EndingStatusId, string>;
}

export const HIGH_SCHOOL_EVENTS = highschoolJson as unknown as StoryEvent[];
export const CORE_EVENTS = coreJson as unknown as StoryEvent[];
export const ARC_EVENTS = arcsJson as unknown as StoryEvent[];
export const MASTERS_EVENTS = mastersJson as unknown as StoryEvent[];
export const ALL_EVENTS: StoryEvent[] = [...HIGH_SCHOOL_EVENTS, ...CORE_EVENTS, ...ARC_EVENTS, ...MASTERS_EVENTS];
export const EVENT_BY_ID: Readonly<Record<string, StoryEvent>> = Object.fromEntries(
  ALL_EVENTS.map((event) => [event.id, event]),
);

export const TEXTS = textsJson as unknown as Texts;
export const ENDING_CARDS = endingCardsJson as unknown as EndingCardsContent;
/** 随构建打包的学校目录快照。引擎函数都把目录作为参数接收，这里只是默认值。 */
export const CATALOG = catalogJson as unknown as RuntimeCatalog;

/** 六条支线的中文名（README 文档导航中的叫法）。 */
export const ARC_NAMES = {
  RESEARCH: "科研",
  INTERNSHIP: "实习",
  FRIENDSHIP: "友情",
  FAMILY: "家庭",
  REORIENTATION: "转向",
  CREATIVE: "创作",
} as const;
