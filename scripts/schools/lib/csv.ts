// IPEDS CSV 读取：处理 BOM、引号、字段内逗号/换行、CRLF，以及 UTF-8 / windows-1252 两种编码。

export interface DecodedText {
  text: string;
  encoding: "utf-8" | "windows-1252";
}

/** 先按严格 UTF-8 解码；出现非法字节序列时回退 windows-1252（IPEDS 旧文件常见）。 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export interface CsvRecord {
  /** 该记录起始的物理行号（1 起）。 */
  line: number;
  fields: string[];
}

/** RFC 4180 解析。返回所有记录（含表头），空行跳过。引号未闭合时抛错。 */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawAny = false;

  const endRecord = () => {
    fields.push(field);
    field = "";
    if (!(fields.length === 1 && fields[0] === "" && !sawAny)) records.push({ line: recordLine, fields });
    fields = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      sawAny = true;
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else if (ch === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
      sawAny = true;
    }
  }
  if (inQuotes) throw new Error(`CSV_UNTERMINATED_QUOTE starting near line ${recordLine}`);
  if (field !== "" || fields.length > 0 || sawAny) endRecord();
  return records;
}

export interface CsvProblem {
  line: number;
  reason: string;
  raw: string;
}

export interface CsvTable {
  header: string[];
  rows: Array<{ line: number; values: Record<string, string> }>;
  problems: CsvProblem[];
  /** 数据记录总数（不含表头）= rows.length + problems.length。 */
  dataRecordCount: number;
}

/** 把 CSV 解析成带表头的表；字段数与表头不符的记录进 problems，不静默丢弃。 */
export function parseCsvTable(input: string): CsvTable {
  const records = parseCsv(input);
  if (records.length === 0) throw new Error("CSV_EMPTY");
  const header = records[0].fields.map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of header) {
    if (name === "") throw new Error("CSV_EMPTY_HEADER_NAME");
    if (seen.has(name)) throw new Error(`CSV_DUPLICATE_HEADER ${name}`);
    seen.add(name);
  }
  const rows: CsvTable["rows"] = [];
  const problems: CsvProblem[] = [];
  for (const record of records.slice(1)) {
    if (record.fields.length !== header.length) {
      problems.push({
        line: record.line,
        reason: `FIELD_COUNT_MISMATCH expected ${header.length} got ${record.fields.length}`,
        raw: record.fields.join(",").slice(0, 300),
      });
      continue;
    }
    const values: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) values[header[i]] = record.fields[i].trim();
    rows.push({ line: record.line, values });
  }
  return { header, rows, problems, dataRecordCount: records.length - 1 };
}
