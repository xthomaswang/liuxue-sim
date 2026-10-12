import { describe, expect, it } from "vitest";
import { applyOverrides, deriveDraft, deriveEligibility, finalizeEligibility } from "../lib/eligibility.ts";
import type { EligibilityOverride } from "../lib/types.ts";
import { hdRow, icRow } from "./helpers.ts";

const labels = {
  fipsLabels: { "42": "Pennsylvania", "6": "California", "64": "Federated States of Micronesia", "72": "Puerto Rico" },
  stabbrLabels: { PA: "Pennsylvania", CA: "California", FM: "Federated States of Micronesia", PR: "Puerto Rico" },
};

describe("资格规则 eligibility-v1", () => {
  it("在办、授学士、招新生、非纯线上、美国境内的学校 → ELIGIBLE，六项事实全为 true", () => {
    const result = deriveEligibility(hdRow(), icRow(), labels);
    expect(result.status).toBe("ELIGIBLE");
    expect(result.reasonCodes).toEqual([]);
    expect(Object.values(result.facts)).toEqual([true, true, true, true, true, true]);
  });

  it("美国属地算境内；自由联系邦（FM/MH/PW）不算", () => {
    expect(deriveEligibility(hdRow({ STABBR: "PR", FIPS: "72", OBEREG: "9" }), icRow(), labels).status).toBe("ELIGIBLE");
    const fm = deriveEligibility(hdRow({ STABBR: "FM", FIPS: "64", OBEREG: "9" }), icRow(), labels);
    expect(fm.status).toBe("EXCLUDED");
    expect(fm.facts.usLocation).toBe(false);
    expect(fm.reasonCodes).toEqual(["OUT_OF_SCOPE_ENTITY", "FREELY_ASSOCIATED_STATE"]);
  });

  it("STABBR 与 FIPS 指向不同地区 → 位置未知，待核而不是猜", () => {
    const result = deriveEligibility(hdRow({ STABBR: "PA", FIPS: "6" }), icRow(), labels);
    expect(result.facts.usLocation).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).toContain("LOCATION_CONFLICT");
  });

  it("系统/学区管理办公室（SECTOR=0）→ OUT_OF_SCOPE_ENTITY", () => {
    const result = deriveEligibility(hdRow({ SECTOR: "0", INSTCAT: "-2" }), icRow({ FT_UG: "-2", FT_FTUG: "-2", PT_UG: "-2", PT_FTUG: "-2", DISTNCED: "-2" }), labels);
    expect(result.status).toBe("EXCLUDED");
    expect(result.reasonCodes).toEqual(["OUT_OF_SCOPE_ENTITY", "ADMINISTRATIVE_UNIT"]);
  });

  it("已关闭 / 停办 / 并入他校 → CLOSED_OR_NO_NEW_INTAKE", () => {
    for (const act of ["M", "D", "C"]) {
      const result = deriveEligibility(hdRow({ ACT: act, CYACTIVE: act === "M" ? "1" : "3", CLOSEDAT: "05312025" }), icRow(), labels);
      expect(result.status).toBe("EXCLUDED");
      expect(result.facts.operating).toBe(false);
      expect(result.reasonCodes).toEqual(["CLOSED_OR_NO_NEW_INTAKE", `IPEDS_ACT_${act}`]);
    }
  });

  it("状态字段互相矛盾（ACT=A 却有关闭日期）→ operating 未知，待核", () => {
    const result = deriveEligibility(hdRow({ CLOSEDAT: "06302025" }), icRow(), labels);
    expect(result.facts.operating).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).toContain("STATUS_CONFLICT");
  });

  it("子校区（ACT=G，数据并入主校区、没有 IC 行）→ 待核，不当作关闭", () => {
    const result = deriveEligibility(hdRow({ ACT: "G", CYACTIVE: "3", SECTOR: "99", HLOFFER: "-3", NEWID: "243780", INSTCAT: "-2" }), undefined, labels);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.facts.operating).toBeNull();
    expect(result.reasonCodes).toContain("CHILD_CAMPUS_REPORTED_WITH_PARENT");
    expect(result.reasonCodes).not.toContain("MISSING_IC_ROW");
  });

  it("只有研究生教育 → GRADUATE_ONLY；最高到副学士/证书 → NO_BACHELOR_PROGRAM", () => {
    const grad = deriveEligibility(hdRow({ UGOFFER: "2", INSTCAT: "1", HDEGOFR1: "12" }), icRow({ LEVEL5: "0", FT_UG: "2", FT_FTUG: "2", PT_UG: "2", PT_FTUG: "2" }), labels);
    expect(grad.status).toBe("EXCLUDED");
    expect(grad.reasonCodes).toEqual(["GRADUATE_ONLY"]);

    const twoYear = deriveEligibility(hdRow({ SECTOR: "4", HLOFFER: "3", HDEGOFR1: "40", INSTCAT: "4" }), icRow({ LEVEL5: "-2" }), labels);
    expect(twoYear.status).toBe("EXCLUDED");
    expect(twoYear.reasonCodes).toEqual(["NO_BACHELOR_PROGRAM"]);
  });

  it("校名里有 Community 但授予学士（INSTCAT=3）的学校不被排除", () => {
    const result = deriveEligibility(hdRow({ INSTNM: "Sample Community College", INSTCAT: "3", HLOFFER: "5", HDEGOFR1: "30", SECTOR: "1" }), icRow(), labels);
    expect(result.status).toBe("ELIGIBLE");
  });

  it("HD 与 IC 的学位层次矛盾 → offersBachelor 保持 null，待核", () => {
    const a = deriveEligibility(hdRow({ HLOFFER: "3" }), icRow({ LEVEL5: "1" }), labels);
    expect(a.facts.offersBachelor).toBeNull();
    expect(a.status).toBe("REVIEW_REQUIRED");
    expect(a.reasonCodes).toContain("HD_IC_CONFLICT");
    const b = deriveEligibility(hdRow({ HLOFFER: "5", HDEGOFR1: "30" }), icRow({ LEVEL5: "0" }), labels);
    expect(b.facts.offersBachelor).toBeNull();
    expect(b.status).toBe("REVIEW_REQUIRED");
  });

  it("不招收首次入学的本科新生 → SPECIAL_ELIGIBILITY_UNSUPPORTED / NO_FIRST_TIME_UNDERGRADUATE_ENROLLMENT", () => {
    const result = deriveEligibility(hdRow(), icRow({ FT_FTUG: "2", PT_FTUG: "2" }), labels);
    expect(result.status).toBe("EXCLUDED");
    expect(result.facts.acceptsNewUndergraduates).toBe(false);
    expect(result.reasonCodes).toEqual(["SPECIAL_ELIGIBILITY_UNSUPPORTED", "NO_FIRST_TIME_UNDERGRADUATE_ENROLLMENT"]);
    expect(deriveEligibility(hdRow(), icRow({ FT_FTUG: "2", PT_FTUG: "1" }), labels).status).toBe("ELIGIBLE");
  });

  it("全部项目完全远程 → ONLINE_ONLY_STORY_MISMATCH", () => {
    const result = deriveEligibility(hdRow(), icRow({ DISTNCED: "1" }), labels);
    expect(result.status).toBe("EXCLUDED");
    expect(result.reasonCodes).toEqual(["ONLINE_ONLY_STORY_MISMATCH"]);
  });

  it("联邦军事院校（OBEREG=0）与不向公众开放（OPENPUBL=0）→ SPECIAL_ELIGIBILITY_UNSUPPORTED", () => {
    const academy = deriveEligibility(hdRow({ OBEREG: "0", SECTOR: "1" }), icRow(), labels);
    expect(academy.status).toBe("EXCLUDED");
    expect(academy.reasonCodes).toEqual(["SPECIAL_ELIGIBILITY_UNSUPPORTED", "US_SERVICE_SCHOOL"]);
    const closedDoor = deriveEligibility(hdRow({ OPENPUBL: "0" }), icRow(), labels);
    expect(closedDoor.reasonCodes).toEqual(["SPECIAL_ELIGIBILITY_UNSUPPORTED", "NOT_OPEN_TO_PUBLIC"]);
  });

  it("没有 IC 行：HD 最高层次低于学士可以确定排除，否则关键事实为 null → 待核", () => {
    const low = deriveEligibility(hdRow({ HLOFFER: "2", HDEGOFR1: "0", INSTCAT: "-1", SECTOR: "9" }), undefined, labels);
    expect(low.status).toBe("EXCLUDED");
    expect(low.reasonCodes).toEqual(["NO_BACHELOR_PROGRAM"]);

    const unknown = deriveEligibility(hdRow({ INSTCAT: "-1" }), undefined, labels);
    expect(unknown.status).toBe("REVIEW_REQUIRED");
    expect(unknown.facts.offersBachelor).toBeNull();
    expect(unknown.facts.acceptsNewUndergraduates).toBeNull();
    expect(unknown.facts.inPersonUndergraduateExperience).toBeNull();
    expect(unknown.reasonCodes).toContain("MISSING_IC_ROW");
  });

  it("IC 里是“不适用”(-2) 的值不被当成 false", () => {
    const result = deriveEligibility(hdRow(), icRow({ DISTNCED: "-2" }), labels);
    expect(result.facts.inPersonUndergraduateExperience).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).toContain("FACT_UNKNOWN_inPersonUndergraduateExperience");
  });

  it("多条排除理由同时成立时全部列出", () => {
    const result = deriveEligibility(hdRow({ OBEREG: "0" }), icRow({ DISTNCED: "1" }), labels);
    expect(result.reasonCodes).toEqual(["ONLINE_ONLY_STORY_MISMATCH", "SPECIAL_ELIGIBILITY_UNSUPPORTED", "US_SERVICE_SCHOOL"]);
  });
});

describe("人工覆盖", () => {
  const override: EligibilityOverride = {
    unitid: "100001", ipedsName: "Test University", fact: "specialEligibilitySupported",
    originalValue: true, correctedValue: false, reasonCode: "SPECIAL_ELIGIBILITY_UNSUPPORTED",
    reason: "官方页面写明本科生须加入学员团。", officialUrl: "https://www.test.edu/about", quote: "all undergraduates are cadets", verifiedAt: "2026-10-11",
  };

  it("把规则识别不出的特殊资格改为 false → EXCLUDED，并带上依据", () => {
    const result = finalizeEligibility(applyOverrides(deriveDraft(hdRow(), icRow(), labels), [override]));
    expect(result.status).toBe("EXCLUDED");
    expect(result.facts.specialEligibilitySupported).toBe(false);
    expect(result.reasonCodes).toEqual(["SPECIAL_ELIGIBILITY_UNSUPPORTED", "OVERRIDE"]);
    expect(result.explanation).toContain("https://www.test.edu/about");
  });

  it("把确认有误的 false 改回 true 后，原先的排除理由随之消失", () => {
    const draft = deriveDraft(hdRow(), icRow({ FT_FTUG: "2", PT_FTUG: "2" }), labels);
    const fixed = applyOverrides(draft, [{ ...override, fact: "acceptsNewUndergraduates", originalValue: false, correctedValue: true, reasonCode: null }]);
    expect(finalizeEligibility(fixed).status).toBe("ELIGIBLE");
  });

  it("覆盖记录的原值与规则推出的值不一致 → 视为过期，直接报错", () => {
    const draft = deriveDraft(hdRow({ OBEREG: "0" }), icRow(), labels);
    expect(() => applyOverrides(draft, [override])).toThrow(/ELIGIBILITY_OVERRIDE_STALE/);
  });

  it("改成 false 却没给原因码 → 报错", () => {
    expect(() => applyOverrides(deriveDraft(hdRow(), icRow(), labels), [{ ...override, reasonCode: null }])).toThrow(/ELIGIBILITY_OVERRIDE_REASON_MISSING/);
  });
});
