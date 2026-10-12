// 资格规则 eligibility-v1（docs/11 §2.1）。纯函数：只读 IPEDS 字典编码字段，不看校名。
// 精选目录仍用它做基本资格检查：在办、授予学士、招收首次入学本科生、非纯线上、美国境内、非军事院校。
// 缺失或互相矛盾的关键值保持 null → REVIEW_REQUIRED，绝不把 null 当 false。

import { ELIGIBILITY_RULE_VERSION } from "./types.ts";
import type { EligibilityOverride, EligibilityStatus, InstitutionFacts } from "./types.ts";
import type { IpedsRow } from "./ipeds.ts";

export { ELIGIBILITY_RULE_VERSION };

const STATES_AND_DC = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "),
);
/** 美国属地。 */
const US_TERRITORIES = new Set(["AS", "GU", "MP", "PR", "VI"]);
/** 自由联系邦：主权国家，IPEDS 因联邦资助项目收录，但不属于美国境内。 */
const FREELY_ASSOCIATED_STATES = new Set(["FM", "MH", "PW"]);

/** 判定时读取的列，原值会写进证据。 */
export const HD_DECISION_COLUMNS = [
  "STABBR", "FIPS", "OBEREG", "SECTOR", "ACT", "CYACTIVE", "CLOSEDAT", "NEWID",
  "HLOFFER", "UGOFFER", "HDEGOFR1", "DEGGRANT", "INSTCAT", "OPENPUBL",
];
export const IC_DECISION_COLUMNS = ["LEVEL5", "FT_UG", "FT_FTUG", "PT_UG", "PT_FTUG", "DISTNCED"];

export interface EligibilityContext {
  fipsLabels?: Record<string, string>;
  stabbrLabels?: Record<string, string>;
}

export interface EligibilityResult {
  facts: InstitutionFacts;
  status: EligibilityStatus;
  /** 第一项是 docs/11 表里的规范原因码，其后是更具体的细分码。 */
  reasonCodes: string[];
  explanation: string;
  hasIcRow: boolean;
}

type FactKey = keyof InstitutionFacts;

/** 规则推导的中间结果：每个事实各自带着“为 false 时的排除码”和“为 null 时的待核码”，便于人工覆盖后重新汇总。 */
export interface EligibilityDraft {
  facts: InstitutionFacts;
  exclusionByFact: Partial<Record<FactKey, string[]>>;
  reviewByFact: Partial<Record<FactKey, string[]>>;
  otherExclusions: string[][];
  otherReviews: string[];
  overrideNotes: string[];
  hasIcRow: boolean;
}

const EXPLANATIONS: Record<string, string> = {
  FREELY_ASSOCIATED_STATE: "所在地是自由联系邦（密克罗尼西亚联邦／马绍尔群岛／帕劳），属主权国家，不在美国境内。",
  ADMINISTRATIVE_UNIT: "IPEDS 将其编码为 Administrative Unit（SECTOR=0），是系统或学区的管理办公室，不是可入读的校园。",
  IPEDS_ACT_M: "IPEDS 状态为 M：本年度内已关闭。",
  IPEDS_ACT_D: "IPEDS 状态为 D：已停办并从目录删除。",
  IPEDS_ACT_C: "IPEDS 状态为 C：已并入其他院校。",
  GRADUATE_ONLY: "不提供本科层次的学位或证书（UGOFFER/INSTCAT 显示仅研究生教育）。",
  NO_BACHELOR_PROGRAM: "不授予学士学位（IC LEVEL5 或 HD HLOFFER 显示最高为副学士／证书）。",
  NO_FIRST_TIME_UNDERGRADUATE_ENROLLMENT:
    "IC 的 FT_FTUG 与 PT_FTUG 均为 No：不招收首次入学的本科新生（常见于只收转学／高年级学生的院校，也可能正在停招）；本游戏“高中毕业直接入学”的前提未表达这种资格。",
  US_SERVICE_SCHOOL: "IPEDS 将其归入 U.S. Service schools（OBEREG=0）；军事院校入学需军方任命等资格，本游戏未表达。",
  NOT_OPEN_TO_PUBLIC: "IPEDS 标注该校不向公众开放招生（OPENPUBL=0）。",
  ONLINE_ONLY_STORY_MISMATCH: "IC 标注全部项目均完全通过远程教育提供（DISTNCED=1），没有本剧情需要的到校生活。",
  CHILD_CAMPUS_REPORTED_WITH_PARENT: "IPEDS 状态为 G：子校区，数据并入主校区（见 NEWID）上报，本行没有独立的院校特征数据。",
  MISSING_IC_ROW: "IC2024 没有该 UNITID 的记录，学位层次、招生与授课方式无法确认。",
  HD_IC_CONFLICT: "HD 与 IC 的学位层次字段互相矛盾。",
  STATUS_CONFLICT: "ACT、CYACTIVE、CLOSEDAT 三个状态字段互相矛盾。",
  LOCATION_CONFLICT: "STABBR 与 FIPS 指向不同的州／属地，或出现未识别的地区代码。",
  IDENTITY_FIELD_MISSING: "UNITID、校名、城市或州缺失／格式异常。",
};

function squash(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 从一行 HD（及对应的 IC 行，可缺）推出各项事实及其原因码，尚未汇总成状态。 */
export function deriveDraft(hd: IpedsRow, ic: IpedsRow | undefined, context: EligibilityContext = {}): EligibilityDraft {
  const exclusionByFact: Partial<Record<FactKey, string[]>> = {};
  const reviewByFact: Partial<Record<FactKey, string[]>> = {};
  const otherExclusions: string[][] = [];
  const otherReviews: string[] = [];

  // ---- usLocation ----
  let usLocation: boolean | null;
  const stabbr = hd.STABBR;
  const labelsDisagree =
    context.fipsLabels !== undefined &&
    context.stabbrLabels !== undefined &&
    context.fipsLabels[hd.FIPS] !== context.stabbrLabels[stabbr];
  if (labelsDisagree) {
    usLocation = null;
    reviewByFact.usLocation = ["LOCATION_CONFLICT"];
  } else if (STATES_AND_DC.has(stabbr) || US_TERRITORIES.has(stabbr)) {
    usLocation = true;
  } else if (FREELY_ASSOCIATED_STATES.has(stabbr)) {
    usLocation = false;
    exclusionByFact.usLocation = ["OUT_OF_SCOPE_ENTITY", "FREELY_ASSOCIATED_STATE"];
  } else {
    usLocation = null;
    reviewByFact.usLocation = ["LOCATION_CONFLICT"];
  }

  if (hd.SECTOR === "0") otherExclusions.push(["OUT_OF_SCOPE_ENTITY", "ADMINISTRATIVE_UNIT"]);

  // ---- operating ----
  let operating: boolean | null;
  const act = hd.ACT;
  if (act === "M" || act === "D" || act === "C") {
    operating = false;
    exclusionByFact.operating = ["CLOSED_OR_NO_NEW_INTAKE", `IPEDS_ACT_${act}`];
  } else if (act === "G") {
    operating = null;
    reviewByFact.operating = ["CHILD_CAMPUS_REPORTED_WITH_PARENT"];
  } else if ((act === "A" || act === "N" || act === "R") && hd.CYACTIVE === "1" && hd.CLOSEDAT === "-2") {
    operating = true;
  } else {
    operating = null;
    reviewByFact.operating = ["STATUS_CONFLICT"];
  }

  // ---- offersBachelor ----
  let offersBachelor: boolean | null;
  const hloffer = Number(hd.HLOFFER);
  if (ic) {
    if (ic.LEVEL5 === "1") {
      const consistent =
        hloffer >= 5 && hd.UGOFFER === "1" && hd.DEGGRANT === "1" && !["1", "4", "5", "6"].includes(hd.INSTCAT);
      offersBachelor = consistent ? true : null;
      if (!consistent) reviewByFact.offersBachelor = ["HD_IC_CONFLICT"];
    } else if (ic.LEVEL5 === "0" || ic.LEVEL5 === "-2") {
      const consistent = hd.HLOFFER !== "5" && hd.HDEGOFR1 !== "30";
      offersBachelor = consistent ? false : null;
      if (!consistent) reviewByFact.offersBachelor = ["HD_IC_CONFLICT"];
    } else {
      offersBachelor = null;
    }
  } else if (hloffer >= 1 && hloffer <= 4) {
    // 没有 IC 行时，HD 的“最高授予层次”低于学士即可确定不授予学士。
    offersBachelor = false;
  } else if (hd.HLOFFER === "5" && hd.HDEGOFR1 === "30") {
    offersBachelor = true;
  } else {
    offersBachelor = null;
  }
  if (offersBachelor === false) {
    const graduateOnly = hd.UGOFFER === "2" || hd.INSTCAT === "1" || hd.INSTCAT === "5";
    exclusionByFact.offersBachelor = [graduateOnly ? "GRADUATE_ONLY" : "NO_BACHELOR_PROGRAM"];
  }

  // ---- acceptsNewUndergraduates（本游戏的入口是首次入学的本科新生）----
  let acceptsNewUndergraduates: boolean | null = null;
  if (ic) {
    if (ic.FT_FTUG === "1" || ic.PT_FTUG === "1") acceptsNewUndergraduates = true;
    else if (ic.FT_FTUG === "2" && ic.PT_FTUG === "2") acceptsNewUndergraduates = false;
  }
  if (acceptsNewUndergraduates === false) {
    exclusionByFact.acceptsNewUndergraduates = ["SPECIAL_ELIGIBILITY_UNSUPPORTED", "NO_FIRST_TIME_UNDERGRADUATE_ENROLLMENT"];
  }

  // ---- inPersonUndergraduateExperience ----
  let inPerson: boolean | null = null;
  if (ic) {
    if (ic.DISTNCED === "2") inPerson = true;
    else if (ic.DISTNCED === "1") inPerson = false;
  }
  if (inPerson === false) exclusionByFact.inPersonUndergraduateExperience = ["ONLINE_ONLY_STORY_MISMATCH"];

  // ---- specialEligibilitySupported ----
  // true 只表示“v1 规则没有识别出本游戏未表达的特殊资格”；IPEDS 无法表达的限制要走人工覆盖。
  let specialEligibilitySupported: boolean | null = true;
  const special: string[] = [];
  if (hd.OBEREG === "0") special.push("US_SERVICE_SCHOOL");
  if (hd.OPENPUBL === "0") special.push("NOT_OPEN_TO_PUBLIC");
  if (special.length > 0) {
    specialEligibilitySupported = false;
    exclusionByFact.specialEligibilitySupported = ["SPECIAL_ELIGIBILITY_UNSUPPORTED", ...special];
  }

  if (!/^\d{6}$/.test(hd.UNITID ?? "") || !squash(hd.INSTNM) || !squash(hd.CITY) || !squash(hd.STABBR)) {
    otherReviews.push("IDENTITY_FIELD_MISSING");
  }

  return {
    facts: {
      operating,
      offersBachelor,
      acceptsNewUndergraduates,
      inPersonUndergraduateExperience: inPerson,
      specialEligibilitySupported,
      usLocation,
    },
    exclusionByFact,
    reviewByFact,
    otherExclusions,
    otherReviews,
    overrideNotes: [],
    hasIcRow: ic !== undefined,
  };
}

const FACT_ORDER: FactKey[] = [
  "usLocation",
  "operating",
  "offersBachelor",
  "acceptsNewUndergraduates",
  "inPersonUndergraduateExperience",
  "specialEligibilitySupported",
];

function explain(codes: string[]): string {
  return codes.map((code) => EXPLANATIONS[code]).filter(Boolean).join("");
}

/** 把中间结果汇总成状态：有确定的排除理由 → EXCLUDED；否则有未知事实 → REVIEW_REQUIRED；否则 ELIGIBLE。 */
export function finalizeEligibility(draft: EligibilityDraft): EligibilityResult {
  const { facts } = draft;
  const exclusion: string[] = [];
  const push = (codes: string[]) => {
    for (const code of codes) if (!exclusion.includes(code)) exclusion.push(code);
  };
  for (const group of draft.otherExclusions) push(group);
  for (const fact of FACT_ORDER) {
    if (facts[fact] !== false) continue;
    // 本来就不授予学士的学校，不再叠加“不招本科新生”的理由。
    if (fact === "acceptsNewUndergraduates" && facts.offersBachelor === false) continue;
    push(draft.exclusionByFact[fact] ?? [`FACT_FALSE_${fact}`]);
  }
  const notes = draft.overrideNotes.join("");
  if (exclusion.length > 0) {
    return { facts, status: "EXCLUDED", reasonCodes: exclusion, explanation: explain(exclusion) + notes, hasIcRow: draft.hasIcRow };
  }

  const review: string[] = [...draft.otherReviews];
  let missingIcNoted = false;
  for (const fact of FACT_ORDER) {
    if (facts[fact] !== null) continue;
    const codes = draft.reviewByFact[fact];
    if (codes) {
      for (const code of codes) if (!review.includes(code)) review.push(code);
    } else if (!draft.hasIcRow && !missingIcNoted && !review.includes("CHILD_CAMPUS_REPORTED_WITH_PARENT")) {
      review.push("MISSING_IC_ROW");
      missingIcNoted = true;
    }
    review.push(`FACT_UNKNOWN_${fact}`);
  }
  if (review.length > 0) {
    return {
      facts,
      status: "REVIEW_REQUIRED",
      reasonCodes: review,
      explanation: (explain(review) || "关键事实缺失，暂不能确认是否适合本科开局。") + notes,
      hasIcRow: draft.hasIcRow,
    };
  }
  return {
    facts,
    status: "ELIGIBLE",
    reasonCodes: [],
    explanation:
      "IPEDS 2024：在办、授予学士学位、招收首次入学本科生、并非全部项目远程授课、位于美国境内，且未识别出本游戏未表达的特殊入学资格。" +
      notes,
    hasIcRow: draft.hasIcRow,
  };
}

/** 规则推导 + 汇总（不含人工覆盖）。 */
export function deriveEligibility(
  hd: IpedsRow,
  ic: IpedsRow | undefined,
  context: EligibilityContext = {},
): EligibilityResult {
  return finalizeEligibility(deriveDraft(hd, ic, context));
}

/**
 * 应用带官方依据的人工覆盖（调用方负责先机械复核 officialUrl + quote）。
 * originalValue 必须等于规则推出的值，否则说明覆盖已过期，直接抛错。
 */
export function applyOverrides(draft: EligibilityDraft, overrides: EligibilityOverride[]): EligibilityDraft {
  if (overrides.length === 0) return draft;
  const next: EligibilityDraft = {
    ...draft,
    facts: { ...draft.facts },
    exclusionByFact: { ...draft.exclusionByFact },
    reviewByFact: { ...draft.reviewByFact },
    overrideNotes: [...draft.overrideNotes],
  };
  for (const override of overrides) {
    if (next.facts[override.fact] !== override.originalValue) {
      throw new Error(
        `ELIGIBILITY_OVERRIDE_STALE ${override.unitid} ${override.fact}: 规则推出 ${next.facts[override.fact]}，覆盖里记录的原值是 ${override.originalValue}`,
      );
    }
    next.facts[override.fact] = override.correctedValue;
    delete next.reviewByFact[override.fact];
    delete next.exclusionByFact[override.fact];
    if (override.correctedValue === false) {
      if (!override.reasonCode) throw new Error(`ELIGIBILITY_OVERRIDE_REASON_MISSING ${override.unitid} ${override.fact}`);
      next.exclusionByFact[override.fact] = [override.reasonCode, "OVERRIDE"];
    }
    next.overrideNotes.push(`人工覆盖（${override.verifiedAt}，${override.officialUrl}）：${override.reason}`);
  }
  return next;
}
