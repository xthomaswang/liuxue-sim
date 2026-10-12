// IPEDS 2024 快照读取与字典绑定。
// 适配器只认它核对过的字典：用到的每个变量必须存在、标题一致、取值代码与标签和这里写死的完全一致，
// 数据里出现字典没有的取值也算失败。字典或数据换版后要先更新这里，再重跑。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBytes, parseCsvTable } from "./csv.ts";
import type { CsvProblem } from "./csv.ts";
import { readXlsx } from "./xlsx.ts";
import type { SheetRows } from "./xlsx.ts";
import type { DirectoryRelease } from "./types.ts";

export const DIRECTORY_YEAR = 2024;
export const IPEDS_DATA_BASE_URL = "https://nces.ed.gov/ipeds/datacenter/data/";

export type IpedsRow = Record<string, string>;

export interface IpedsFileMeta {
  id: string;
  zipFilename: string;
  zipSha256: string;
  zipBytes: number;
  csvMember: string;
  csvSha256: string;
  csvBytes: number;
  csvEncoding: string;
  dictionaryZipFilename: string;
  dictionaryZipSha256: string;
  dictionaryMember: string;
  dictionaryTitle: string;
  /** 字典 Introduction 表第二行的发布标注原文，例如 "(Provisional release 1)"。 */
  releaseLabel: string | null;
  dataRows: number;
  problems: CsvProblem[];
}

export interface IpedsSnapshot {
  dir: string;
  fetchedAt: string;
  hd: IpedsRow[];
  ic: IpedsRow[];
  hdMeta: IpedsFileMeta;
  icMeta: IpedsFileMeta;
  directoryRelease: DirectoryRelease;
  directoryReleaseBasis: Record<string, string | null>;
  /** FIPS 代码 → 字典里的州/属地名称。 */
  fipsLabels: Record<string, string>;
  stabbrLabels: Record<string, string>;
}

interface VarSpec {
  name: string;
  title?: string;
  codes?: Record<string, string>;
}

const YES_NO_NA = { "1": "Yes", "2": "No", "-2": "Not applicable" };

/** HD2024 里本管线用到的变量。codes 是“代码 → 字典标签”，必须与字典逐项相等。 */
export const HD_SPECS: VarSpec[] = [
  { name: "UNITID", title: "Unique identification number of the institution" },
  { name: "INSTNM", title: "Institution (entity) name" },
  { name: "IALIAS", title: "Institution name alias" },
  { name: "CITY", title: "City location of institution" },
  { name: "STABBR", title: "State abbreviation" },
  { name: "FIPS", title: "FIPS state code" },
  {
    name: "OBEREG",
    title: "Bureau of Economic Analysis (BEA) regions",
    codes: {
      "0": "US Service schools",
      "1": "New England CT ME MA NH RI VT",
      "2": "Mid East DE DC MD NJ NY PA",
      "3": "Great Lakes IL IN MI OH WI",
      "4": "Plains IA KS MN MO NE ND SD",
      "5": "Southeast AL AR FL GA KY LA MS NC SC TN VA WV",
      "6": "Southwest AZ NM OK TX",
      "7": "Rocky Mountains CO ID MT UT WY",
      "8": "Far West AK CA HI NV OR WA",
      "9": "Outlying areas AS FM GU MH MP PR PW VI",
    },
  },
  { name: "OPEID", title: "Office of Postsecondary Education (OPE) ID Number" },
  { name: "WEBADDR", title: "Institution's internet website address" },
  {
    name: "SECTOR",
    title: "Sector of institution",
    codes: {
      "0": "Administrative Unit",
      "1": "Public, 4-year or above",
      "2": "Private not-for-profit, 4-year or above",
      "3": "Private for-profit, 4-year or above",
      "4": "Public, 2-year",
      "5": "Private not-for-profit, 2-year",
      "6": "Private for-profit, 2-year",
      "7": "Public, less-than 2-year",
      "8": "Private not-for-profit, less-than 2-year",
      "9": "Private for-profit, less-than 2-year",
      "99": "Sector unknown (not active)",
    },
  },
  {
    name: "HLOFFER",
    title: "Highest level of offering",
    codes: {
      "1": "Award of less than one academic year",
      "2": "At least 1, but less than 2 academic yrs",
      "3": "Associate's degree",
      "4": "At least 2, but less than 4 academic yrs",
      "5": "Bachelor's degree",
      "6": "Postbaccalaureate certificate",
      "7": "Master's degree",
      "8": "Post-master's certificate",
      "9": "Doctor's degree",
      "-3": "{Not available}",
    },
  },
  {
    name: "UGOFFER",
    title: "Undergraduate offering",
    codes: {
      "1": "Undergraduate degree or certificate offering",
      "2": "No undergraduate offering",
      "-3": "{Not available}",
    },
  },
  {
    name: "HDEGOFR1",
    title: "Highest degree offered",
    codes: {
      "11": "Doctor's degree - research/scholarship and professional practice",
      "12": "Doctor's degree - research/scholarship",
      "13": "Doctor's degree - professional practice",
      "14": "Doctor's degree - other",
      "20": "Master's degree",
      "30": "Bachelor's degree",
      "40": "Associates",
      "0": "Non-degree granting",
      "-3": "{Not available}",
    },
  },
  {
    name: "DEGGRANT",
    title: "Degree-granting status",
    codes: {
      "1": "Degree-granting",
      "2": "Nondegree-granting, primarily postsecondary",
      "-3": "{Not available}",
    },
  },
  {
    name: "OPENPUBL",
    title: "Institution open to the general public",
    codes: {
      "1": "Institution is open to the public",
      "0": "Institution is not open to the public",
    },
  },
  {
    name: "ACT",
    title: "Status of institution",
    codes: {
      A: "Active - institution active",
      N: "New - added during the current year",
      R: "Restore - restored to the current universe",
      M: "Closed in current year (active has data)",
      C: "Combined with other institution",
      D: "Delete out of business",
      G: "Perfect child campus - data reported with main campus, but is listed on college navigator",
    },
  },
  { name: "NEWID", title: "UNITID for merged schools" },
  { name: "CLOSEDAT", title: "Date institution closed" },
  {
    name: "CYACTIVE",
    title: "Institution is active in current year",
    codes: { "1": "Yes", "3": "No, closed, combined, or out-of-scope" },
  },
  {
    name: "INSTCAT",
    title: "Institutional category",
    codes: {
      "1": "Degree-granting, graduate with no undergraduate degrees",
      "2": "Degree-granting, primarily baccalaureate or above",
      "3": "Degree-granting, not primarily baccalaureate or above",
      "4": "Degree-granting, associate's and certificates",
      "5": "Nondegree-granting, above the baccalaureate",
      "6": "Nondegree-granting, sub-baccalaureate",
      "-1": "Not reported",
      "-2": "Not applicable",
    },
  },
  {
    name: "F1SYSTYP",
    title: "Multi-institution or multi-campus organization",
    codes: {
      "1": "Institution is part of a multi-institution or multi-campus organization",
      "2": "Institution is NOT part of a multi-institution or multi-campus organization",
      "-1": "Not reported",
      "-2": "Not applicable",
    },
  },
  { name: "F1SYSNAM", title: "Name of multi-institution or multi-campus organization" },
];

/** IC2024 里本管线用到的变量。 */
export const IC_SPECS: VarSpec[] = [
  { name: "UNITID", title: "Unique identification number of the institution" },
  { name: "LEVEL5", title: "Bachelor's degree", codes: { "1": "Yes", "0": "Implied no", "-2": "Not applicable" } },
  { name: "FT_UG", title: "Full-time undergraduate students are enrolled", codes: YES_NO_NA },
  {
    name: "FT_FTUG",
    title: "Full time first-time degree/certificate-seeking undergraduate students enrolled",
    codes: YES_NO_NA,
  },
  { name: "PT_UG", title: "Part-time undergraduate students are enrolled", codes: YES_NO_NA },
  {
    name: "PT_FTUG",
    title: "Part time first-time degree/certificate-seeking undergraduate students enrolled",
    codes: YES_NO_NA,
  },
  { name: "DISTNCED", title: "All programs offered completely via distance education", codes: YES_NO_NA },
];

/** 字典里必须保持这些含义的 FIPS 代码（属地与自由联系邦的判断依赖它们）。 */
const REQUIRED_FIPS_LABELS: Record<string, string> = {
  "11": "District of Columbia",
  "60": "American Samoa",
  "64": "Federated States of Micronesia",
  "66": "Guam",
  "68": "Marshall Islands",
  "69": "Northern Marianas",
  "70": "Palau",
  "72": "Puerto Rico",
  "78": "Virgin Islands",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function squash(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function listZipMembers(zipPath: string): string[] {
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readZipMember(zipPath: string, member: string): Buffer {
  return execFileSync("unzip", ["-p", zipPath, member], { maxBuffer: 512 * 1024 * 1024 });
}

function pickMember(zipPath: string, baseName: string, extension: string): string {
  const members = listZipMembers(zipPath);
  const wanted = `${baseName}${extension}`.toLowerCase();
  const exact = members.find((member) => member.toLowerCase() === wanted);
  if (exact) return exact;
  throw new Error(`IPEDS_ZIP_MEMBER_MISSING ${zipPath} 需要 ${wanted}，实际 ${members.join(", ")}`);
}

interface Dictionary {
  title: string;
  releaseLabel: string | null;
  varTitles: Map<string, string>;
  codeLabels: Map<string, Map<string, string>>;
}

function columnOf(rows: SheetRows, name: string, sheet: string): number {
  const index = (rows[0] ?? []).findIndex((cell) => String(cell ?? "").toLowerCase() === name.toLowerCase());
  if (index < 0) throw new Error(`IPEDS_DICT_COLUMN_MISSING ${sheet}.${name}`);
  return index;
}

function loadDictionary(xlsxPath: string): Dictionary {
  const sheets = readXlsx(xlsxPath);
  const intro = sheets.get("Introduction");
  const varlist = sheets.get("Varlist");
  const frequencies = sheets.get("Frequencies");
  if (!intro || !varlist || !frequencies) throw new Error(`IPEDS_DICT_SHEETS_MISSING ${xlsxPath}`);
  const title = squash(intro[0]?.[0]);
  const second = squash(intro[1]?.[0]);
  const releaseLabel = /^\(.*\)$/.test(second) ? second : null;

  const varTitles = new Map<string, string>();
  const vName = columnOf(varlist, "varName", "Varlist");
  const vTitle = columnOf(varlist, "varTitle", "Varlist");
  for (const row of varlist.slice(1)) {
    if (row[vName] !== null && row[vName] !== undefined) varTitles.set(squash(row[vName]), squash(row[vTitle]));
  }

  const codeLabels = new Map<string, Map<string, string>>();
  const fName = columnOf(frequencies, "VarName", "Frequencies");
  const fCode = columnOf(frequencies, "CodeValue", "Frequencies");
  const fLabel = columnOf(frequencies, "ValueLabel", "Frequencies");
  for (const row of frequencies.slice(1)) {
    const name = squash(row[fName]);
    if (!name) continue;
    if (!codeLabels.has(name)) codeLabels.set(name, new Map());
    codeLabels.get(name)!.set(squash(row[fCode]), squash(row[fLabel]));
  }
  return { title, releaseLabel, varTitles, codeLabels };
}

/** 字典绑定：任何不一致都抛错，不带着猜测继续。 */
export function assertDictionaryBinding(
  label: string,
  specs: VarSpec[],
  dictionary: Dictionary,
  header: string[],
  rows: IpedsRow[],
): void {
  const failures: string[] = [];
  for (const spec of specs) {
    if (!header.includes(spec.name)) failures.push(`${label}.${spec.name}: CSV 缺少该列`);
    const title = dictionary.varTitles.get(spec.name);
    if (title === undefined) {
      failures.push(`${label}.${spec.name}: 字典 Varlist 缺少该变量`);
      continue;
    }
    if (spec.title !== undefined && title !== spec.title) {
      failures.push(`${label}.${spec.name}: 标题不符，字典为「${title}」，适配器按「${spec.title}」理解`);
    }
    if (!spec.codes) continue;
    const actual = dictionary.codeLabels.get(spec.name) ?? new Map<string, string>();
    for (const [code, expectedLabel] of Object.entries(spec.codes)) {
      const actualLabel = actual.get(code);
      if (actualLabel === undefined) failures.push(`${label}.${spec.name}: 字典缺少代码 ${code}`);
      else if (actualLabel !== expectedLabel) {
        failures.push(`${label}.${spec.name}=${code}: 标签不符，字典为「${actualLabel}」，适配器按「${expectedLabel}」理解`);
      }
    }
    for (const code of actual.keys()) {
      if (!(code in spec.codes)) failures.push(`${label}.${spec.name}: 字典出现适配器未处理的代码 ${code}（${actual.get(code)}）`);
    }
    const unknown = new Set<string>();
    for (const row of rows) if (!(row[spec.name] in spec.codes)) unknown.add(row[spec.name]);
    if (unknown.size > 0) failures.push(`${label}.${spec.name}: 数据出现字典外取值 ${[...unknown].slice(0, 8).join(", ")}`);
  }
  if (failures.length > 0) throw new Error(`IPEDS_DICTIONARY_BINDING_FAILED\n  ${failures.join("\n  ")}`);
}

function releaseFromLabel(label: string | null): DirectoryRelease | null {
  if (!label) return null;
  if (/provisional/i.test(label)) return "PROVISIONAL";
  if (/final/i.test(label)) return "FINAL";
  return null;
}

function loadFile(
  dir: string,
  work: string,
  base: string,
  specs: VarSpec[],
): { rows: IpedsRow[]; header: string[]; meta: IpedsFileMeta; dictionary: Dictionary } {
  const zipPath = join(dir, `${base}.zip`);
  const dictZipPath = join(dir, `${base}_Dict.zip`);
  for (const path of [zipPath, dictZipPath]) {
    if (!existsSync(path)) throw new Error(`IPEDS_FILE_MISSING ${path}`);
  }
  const zipBytes = readFileSync(zipPath);
  const csvMember = pickMember(zipPath, base, ".csv");
  const csvBytes = readZipMember(zipPath, csvMember);
  const decoded = decodeBytes(csvBytes);
  const table = parseCsvTable(decoded.text);
  if (table.rows.length === 0) throw new Error(`IPEDS_EMPTY_TABLE ${zipPath}`);

  const dictZipBytes = readFileSync(dictZipPath);
  const dictMember = pickMember(dictZipPath, `${base}_dict`, ".xlsx");
  execFileSync("unzip", ["-o", "-q", dictZipPath, dictMember, "-d", work]);
  const dictionary = loadDictionary(join(work, dictMember));

  const rows = table.rows.map((row) => row.values);
  assertDictionaryBinding(base, specs, dictionary, table.header, rows);

  return {
    rows,
    header: table.header,
    dictionary,
    meta: {
      id: `ipeds-${base.toLowerCase()}`,
      zipFilename: `${base}.zip`,
      zipSha256: sha256(zipBytes),
      zipBytes: zipBytes.length,
      csvMember,
      csvSha256: sha256(csvBytes),
      csvBytes: csvBytes.length,
      csvEncoding: decoded.encoding,
      dictionaryZipFilename: `${base}_Dict.zip`,
      dictionaryZipSha256: sha256(dictZipBytes),
      dictionaryMember: dictMember,
      dictionaryTitle: dictionary.title,
      releaseLabel: dictionary.releaseLabel,
      dataRows: table.dataRecordCount,
      problems: table.problems,
    },
  };
}

function readFetchedAt(dir: string, fallbackPath: string): string {
  const marker = join(dir, "FETCHED_AT.txt");
  if (existsSync(marker)) {
    const match = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(readFileSync(marker, "utf8"));
    if (match) return match[0];
  }
  return statSync(fallbackPath).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 读取 <dir>/HD2024.zip、IC2024.zip 及两份字典压缩包；解压只发生在系统临时目录。 */
export function loadIpedsSnapshot(dir: string): IpedsSnapshot {
  const work = mkdtempSync(join(tmpdir(), "liuxue-ipeds-"));
  try {
    const hd = loadFile(dir, work, `HD${DIRECTORY_YEAR}`, HD_SPECS);
    const ic = loadFile(dir, work, `IC${DIRECTORY_YEAR}`, IC_SPECS);

    const fipsLabels = Object.fromEntries(hd.dictionary.codeLabels.get("FIPS") ?? []);
    const stabbrLabels = Object.fromEntries(hd.dictionary.codeLabels.get("STABBR") ?? []);
    const failures: string[] = [];
    for (const [code, expected] of Object.entries(REQUIRED_FIPS_LABELS)) {
      if (fipsLabels[code] !== expected) failures.push(`HD.FIPS=${code}: 字典为「${fipsLabels[code]}」，适配器按「${expected}」理解`);
    }
    const seen = new Set<string>();
    for (const row of hd.rows) {
      if (seen.has(row.UNITID)) failures.push(`HD.UNITID 重复：${row.UNITID}`);
      seen.add(row.UNITID);
      if (!(row.FIPS in fipsLabels)) failures.push(`HD.FIPS: 数据出现字典外取值 ${row.FIPS}（UNITID ${row.UNITID}）`);
      if (!(row.STABBR in stabbrLabels)) failures.push(`HD.STABBR: 数据出现字典外取值 ${row.STABBR}（UNITID ${row.UNITID}）`);
    }
    const icSeen = new Set<string>();
    for (const row of ic.rows) {
      if (icSeen.has(row.UNITID)) failures.push(`IC.UNITID 重复：${row.UNITID}`);
      icSeen.add(row.UNITID);
      if (!seen.has(row.UNITID)) failures.push(`IC.UNITID ${row.UNITID} 在 HD 中不存在`);
    }
    if (failures.length > 0) throw new Error(`IPEDS_SNAPSHOT_INVALID\n  ${failures.slice(0, 40).join("\n  ")}`);

    // 发布状态只从字典自带的标注读取；HD 字典没有 provisional/final 字样时，沿用同批次 IC 字典的标注。
    const hdRelease = releaseFromLabel(hd.meta.releaseLabel);
    const icRelease = releaseFromLabel(ic.meta.releaseLabel);
    const directoryRelease: DirectoryRelease = hdRelease ?? icRelease ?? "UNVERIFIED";
    return {
      dir,
      fetchedAt: readFetchedAt(dir, join(dir, `HD${DIRECTORY_YEAR}.zip`)),
      hd: hd.rows,
      ic: ic.rows,
      hdMeta: hd.meta,
      icMeta: ic.meta,
      directoryRelease,
      directoryReleaseBasis: {
        hdDictionaryTitle: hd.meta.dictionaryTitle,
        hdDictionaryReleaseLabel: hd.meta.releaseLabel,
        icDictionaryTitle: ic.meta.dictionaryTitle,
        icDictionaryReleaseLabel: ic.meta.releaseLabel,
        rule: hdRelease
          ? "取自 HD 字典 Introduction 表的发布标注"
          : icRelease
            ? "HD 字典只写了 Release 编号、没有 provisional/final 字样；按同一批次（2024-25 采集、同日发布）IC 字典的发布标注判定"
            : "两份字典都没有 provisional/final 标注，如实记为 UNVERIFIED",
      },
      fipsLabels,
      stabbrLabels,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
