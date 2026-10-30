import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Express } from "express";
import * as XLSX from "xlsx";

/** Cap on the total bytes a single workbook may expand to (zip bomb guard). */
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
/** Cap on the number of zip entries one workbook may contain. */
const MAX_ZIP_ENTRIES = 4096;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
/** End-of-central-directory record is 22 bytes + up to 65535 bytes of comment. */
const EOCD_MIN_SIZE = 22;
const MAX_ZIP_COMMENT = 0xffff;

/** Raw content of a single worksheet: its name plus a matrix of string cell values. */
export interface XlsxSheetMatrix {
  sheetName: string;
  rows: string[][];
}

@Injectable()
export class XLSXService {
  private readonly logger = new Logger(XLSXService.name);
  // All methods are stateless: the workbook is held by the caller, never by
  // this singleton. Keeping per-request workbook state on the service instance
  // would let concurrent requests corrupt each other.
  createWorkbook(): XLSX.WorkBook {
    return XLSX.utils.book_new();
  }

  //****************************************/
  //* Stateless buffer parsing (multi-sheet) */
  //****************************************/

  /**
   * Parse every sheet of an xlsx buffer into raw string matrices.
   *
   * Unlike the stateful loadFile/getRows flow (which targets object-style CRUD
   * imports), this method preserves the full grid including the header row and
   * empty cells, making it suitable for downstream consumers (e.g. LLM prompts)
   * that need an exact textual representation of the workbook.
   *
   * - `cellDates: true` parses date-formatted cells into JS Date objects, which
   *   are normalized to UTC `YYYY-MM-DD` to avoid timezone drift on bank data.
   * - `header: 1` returns raw row arrays; `defval: ''` fills empty cells so
   *   columns stay aligned.
   * - The buffer is rejected before parsing when its zip container would
   *   expand past a sane bound (zip bomb), and the parser's own console
   *   warnings are left untouched: overriding the global console from a
   *   request path is not safe for concurrent callers.
   */
  parseToMatrix(buffer: Buffer): XlsxSheetMatrix[] {
    this.assertReasonableZipVolume(buffer);

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      // header:1 returns raw row arrays; defval:'' fills empty cells.
      const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });
      const rows: string[][] = rawRows.map((row) =>
        (row as unknown[]).map((cell) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? ""))),
      );
      return { sheetName, rows };
    });
  }

  /**
   * Reject a workbook whose zip container declares an implausibly large
   * uncompressed payload. The central directory carries the uncompressed size
   * of every entry (even when local headers use data descriptors), so the
   * check is a cheap read-before-inflate. Buffers that are not zip containers
   * are left to the parser, which reports the real format error.
   */
  private assertReasonableZipVolume(buffer: Buffer): void {
    const eocd = this.findEndOfCentralDirectory(buffer);
    if (eocd < 0) {
      this.logger.debug("Workbook buffer has no zip end-of-central-directory record; deferring to the parser");
      return;
    }

    const declaredEntries = buffer.readUInt16LE(eocd + 10);
    if (declaredEntries > MAX_ZIP_ENTRIES) {
      throw new BadRequestException(`Workbook has ${declaredEntries} zip entries; the limit is ${MAX_ZIP_ENTRIES}.`);
    }

    const centralDirOffset = buffer.readUInt32LE(eocd + 16);
    let offset = centralDirOffset;
    let seen = 0;
    let totalUncompressed = 0;

    while (offset + 46 <= buffer.length && buffer.readUInt32LE(offset) === CENTRAL_DIR_SIGNATURE) {
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      if (uncompressedSize === 0xffffffff) {
        throw new BadRequestException("Zip64 workbooks are not supported; re-save the file as a plain xlsx.");
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new BadRequestException(
          `Workbook expands to more than ${MAX_UNCOMPRESSED_BYTES} bytes; refusing to parse it.`,
        );
      }
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      offset += 46 + nameLength + extraLength + commentLength;
      seen += 1;
      if (seen > MAX_ZIP_ENTRIES) {
        throw new BadRequestException(`Workbook has more than ${MAX_ZIP_ENTRIES} zip entries.`);
      }
    }
  }

  /** Offset of the end-of-central-directory record, or -1 when absent. */
  private findEndOfCentralDirectory(buffer: Buffer): number {
    if (buffer.length < EOCD_MIN_SIZE) return -1;
    const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_ZIP_COMMENT);
    for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
      if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
    }
    return -1;
  }

  getSheets(workbook: XLSX.WorkBook): string[] {
    return workbook.SheetNames;
  }

  //**********************/
  //* Load file          */
  //**********************/

  loadLocalFile(filePath: string): XLSX.WorkBook {
    return XLSX.readFile(filePath);
  }

  loadFile(file: Express.Multer.File): XLSX.WorkBook {
    return XLSX.read(file.buffer);
  }

  loadBuffer(buffer: Buffer): XLSX.WorkBook {
    return XLSX.read(buffer);
  }

  //************************/
  //* Get columns and rows */
  //************************/

  getColumnsBySheetIndex(workbook: XLSX.WorkBook, index: number): string[] {
    const sheet = workbook.Sheets[workbook.SheetNames[index]];

    return this.getColumns(sheet);
  }

  getColumnsBySheetName(workbook: XLSX.WorkBook, name: string): string[] {
    const sheet = workbook.Sheets[name];

    return this.getColumns(sheet);
  }

  getRowsBySheetIndex(workbook: XLSX.WorkBook, index: number): object[] {
    const sheet = workbook.Sheets[workbook.SheetNames[index]];
    return this.getRows(sheet);
  }

  getRowsBySheetName(workbook: XLSX.WorkBook, name: string): object[] {
    const sheet = workbook.Sheets[name];
    return this.getRows(sheet);
  }

  //**********************/
  //* Save file          */
  //**********************/

  writeFile(workbook: XLSX.WorkBook, fileName: string) {
    XLSX.writeFile(workbook, fileName);
  }

  //**********************/
  //* Private operations */
  //**********************/

  private getColumns(sheet: XLSX.WorkSheet): string[] {
    const columns: string[] = [];

    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const startRow = range.s.r; // start in the first row

      // walk every column in the range
      for (let C = range.s.c; C <= range.e.c; ++C) {
        let column = "UNKNOWN " + C; // <-- replace with your desired default

        const cell = sheet[XLSX.utils.encode_cell({ c: C, r: startRow })]; // find the cell in the first row
        if (cell && cell.t) {
          column = XLSX.utils.format_cell(cell);
        }

        columns.push(column);
      }
    }

    return columns;
  }

  private getRows(sheet: XLSX.WorkSheet): object[] {
    return XLSX.utils.sheet_to_json(sheet);
  }
}
