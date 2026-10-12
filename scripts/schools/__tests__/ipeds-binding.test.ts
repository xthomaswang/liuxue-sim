import { describe, expect, it } from "vitest";
import { assertDictionaryBinding, HD_SPECS, IC_SPECS } from "../lib/ipeds.ts";

const specs = [
  { name: "UNITID", title: "Unique identification number of the institution" },
  { name: "LEVEL5", title: "Bachelor's degree", codes: { "1": "Yes", "0": "Implied no", "-2": "Not applicable" } },
];

function dictionary(overrides: { title?: string; codes?: Array<[string, string]>; dropVar?: boolean } = {}) {
  const varTitles = new Map<string, string>([["UNITID", "Unique identification number of the institution"]]);
  if (!overrides.dropVar) varTitles.set("LEVEL5", overrides.title ?? "Bachelor's degree");
  const codeLabels = new Map<string, Map<string, string>>([
    ["LEVEL5", new Map(overrides.codes ?? [["1", "Yes"], ["0", "Implied no"], ["-2", "Not applicable"]])],
  ]);
  return { title: "test dictionary", releaseLabel: null, varTitles, codeLabels };
}

const header = ["UNITID", "LEVEL5"];
const rows = [{ UNITID: "100001", LEVEL5: "1" }, { UNITID: "100002", LEVEL5: "-2" }];

describe("IPEDS 字典绑定", () => {
  it("变量存在、标题与代码标签都一致、数据取值都在字典内 → 通过", () => {
    expect(() => assertDictionaryBinding("IC", specs, dictionary(), header, rows)).not.toThrow();
  });

  it("字典里的标签与适配器的理解不一致 → 构建失败", () => {
    const changed = dictionary({ codes: [["1", "No"], ["0", "Implied no"], ["-2", "Not applicable"]] });
    expect(() => assertDictionaryBinding("IC", specs, changed, header, rows)).toThrow(/IC\.LEVEL5=1: 标签不符/);
  });

  it("变量标题换了含义 → 构建失败", () => {
    expect(() => assertDictionaryBinding("IC", specs, dictionary({ title: "Associate's degree" }), header, rows)).toThrow(/标题不符/);
  });

  it("字典或 CSV 缺少用到的变量 → 构建失败", () => {
    expect(() => assertDictionaryBinding("IC", specs, dictionary({ dropVar: true }), header, rows)).toThrow(/字典 Varlist 缺少该变量/);
    expect(() => assertDictionaryBinding("IC", specs, dictionary(), ["UNITID"], rows)).toThrow(/CSV 缺少该列/);
  });

  it("字典多出适配器没处理的代码，或数据出现字典外取值 → 构建失败", () => {
    const extra = dictionary({ codes: [["1", "Yes"], ["0", "Implied no"], ["-2", "Not applicable"], ["-1", "Not reported"]] });
    expect(() => assertDictionaryBinding("IC", specs, extra, header, rows)).toThrow(/未处理的代码 -1/);
    const odd = [...rows, { UNITID: "100003", LEVEL5: "7" }];
    expect(() => assertDictionaryBinding("IC", specs, dictionary(), header, odd)).toThrow(/字典外取值 7/);
  });

  it("适配器声明了它依赖的全部判定变量", () => {
    const hd = HD_SPECS.map((spec) => spec.name);
    for (const name of ["UNITID", "INSTNM", "CITY", "STABBR", "FIPS", "OBEREG", "SECTOR", "ACT", "CYACTIVE", "CLOSEDAT", "HLOFFER", "UGOFFER", "HDEGOFR1", "DEGGRANT", "INSTCAT", "OPENPUBL"]) {
      expect(hd, name).toContain(name);
    }
    expect(IC_SPECS.map((spec) => spec.name)).toEqual(["UNITID", "LEVEL5", "FT_UG", "FT_FTUG", "PT_UG", "PT_FTUG", "DISTNCED"]);
  });
});
