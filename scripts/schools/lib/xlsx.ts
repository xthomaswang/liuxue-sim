// 极简 xlsx 读取：只为读 IPEDS 字典（*_dict.xlsx）。xlsx 是 zip + XML，用系统 unzip 取出成员再解析。
// 只支持共享字符串、内联字符串与数值单元格；足够覆盖 EPPlus 生成的字典文件。

import { execFileSync } from "node:child_process";

export type Cell = string | number | null;
export type SheetRows = Cell[][];

function unzipMember(xlsxPath: string, member: string): string {
  return execFileSync("unzip", ["-p", xlsxPath, member], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
    }
  });
}

function textOf(fragment: string): string {
  let out = "";
  for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(match[1]);
  return out;
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** 读取工作簿里全部工作表，按表名返回二维数组（缺失单元格为 null）。 */
export function readXlsx(xlsxPath: string): Map<string, SheetRows> {
  const workbook = unzipMember(xlsxPath, "xl/workbook.xml");
  const rels = unzipMember(xlsxPath, "xl/_rels/workbook.xml.rels");
  const targetById = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) targetById.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }

  let shared: string[] = [];
  try {
    const sharedXml = unzipMember(xlsxPath, "xl/sharedStrings.xml");
    shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  } catch {
    shared = [];
  }

  const sheets = new Map<string, SheetRows>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(match[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(match[0])?.[1];
    if (!name || !rid) continue;
    const target = targetById.get(rid);
    if (!target) throw new Error(`XLSX_SHEET_TARGET_MISSING ${xlsxPath} ${name}`);
    const xml = unzipMember(xlsxPath, target);
    const rows: SheetRows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const body = rowMatch[1] ?? "";
      const row: Cell[] = [];
      for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cellMatch[1];
        const inner = cellMatch[2] ?? "";
        const ref = /\br="([A-Z]+)[0-9]+"/.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const index = ref ? columnIndex(ref) : row.length;
        let value: Cell = null;
        if (type === "inlineStr") {
          value = textOf(inner);
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          if (raw !== undefined) {
            if (type === "s") value = shared[Number(raw)] ?? null;
            else if (type === "str" || type === "b" || type === "e") value = decodeXml(raw);
            else {
              const num = Number(raw);
              value = Number.isFinite(num) ? num : decodeXml(raw);
            }
          }
        }
        while (row.length < index) row.push(null);
        row[index] = value;
      }
      rows.push(row);
    }
    sheets.set(decodeXml(name), rows);
  }
  return sheets;
}
