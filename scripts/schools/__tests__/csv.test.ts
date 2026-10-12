import { describe, expect, it } from "vitest";
import { decodeBytes, parseCsv, parseCsvTable } from "../lib/csv.ts";

describe("IPEDS CSV 解析", () => {
  it("处理 BOM、引号、字段内逗号与转义引号", () => {
    const text = '﻿UNITID,INSTNM,CITY\r\n100654,"Alabama A & M University","Normal"\r\n100663,"Smith, Jones ""Tech"" Institute",Birmingham\r\n';
    const table = parseCsvTable(text);
    expect(table.header).toEqual(["UNITID", "INSTNM", "CITY"]);
    expect(table.rows.map((row) => row.values)).toEqual([
      { UNITID: "100654", INSTNM: "Alabama A & M University", CITY: "Normal" },
      { UNITID: "100663", INSTNM: 'Smith, Jones "Tech" Institute', CITY: "Birmingham" },
    ]);
    expect(table.problems).toEqual([]);
    expect(table.dataRecordCount).toBe(2);
  });

  it("引号内的换行属于字段，行号按物理行记", () => {
    const records = parseCsv('A,B\n1,"two\nlines"\n3,4\n');
    expect(records.map((record) => record.fields)).toEqual([["A", "B"], ["1", "two\nlines"], ["3", "4"]]);
    expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
  });

  it("支持 LF、CRLF 与末行无换行，跳过空行", () => {
    expect(parseCsv("A,B\n1,2\n\n3,4").map((record) => record.fields)).toEqual([["A", "B"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("A,B\r\n1,\r\n").map((record) => record.fields)).toEqual([["A", "B"], ["1", ""]]);
  });

  it("字段数与表头不符的行进 problems，不静默丢弃，行数对得上", () => {
    const table = parseCsvTable("A,B,C\n1,2,3\n4,5\n6,7,8,9\n");
    expect(table.rows).toHaveLength(1);
    expect(table.problems.map((problem) => problem.line)).toEqual([3, 4]);
    expect(table.rows.length + table.problems.length).toBe(table.dataRecordCount);
  });

  it("值两端的空白被去掉（IPEDS 的 OPEID 等字段带尾随空格）", () => {
    expect(parseCsvTable('A,B\n"00324200  "," x "\n').rows[0].values).toEqual({ A: "00324200", B: "x" });
  });

  it("引号未闭合、空文件、重复表头都直接报错", () => {
    expect(() => parseCsv('A\n"oops\n')).toThrow(/CSV_UNTERMINATED_QUOTE/);
    expect(() => parseCsvTable("")).toThrow(/CSV_EMPTY/);
    expect(() => parseCsvTable("A,A\n1,2\n")).toThrow(/CSV_DUPLICATE_HEADER/);
  });

  it("先按严格 UTF-8 解码，失败时回退 windows-1252", () => {
    const utf8 = new TextEncoder().encode("Bayamón");
    expect(decodeBytes(utf8)).toEqual({ text: "Bayamón", encoding: "utf-8" });
    const latin = new Uint8Array([0x42, 0x61, 0x79, 0x61, 0x6d, 0xf3, 0x6e]); // "Bayamón" in windows-1252
    expect(decodeBytes(latin)).toEqual({ text: "Bayamón", encoding: "windows-1252" });
  });
});
