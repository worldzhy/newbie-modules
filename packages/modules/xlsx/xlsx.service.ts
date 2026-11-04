import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import ExcelJS from "exceljs";

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

  //****************************************/
  //* Stateless buffer parsing (multi-sheet) */
  //****************************************/

  /**
   * Parse every sheet of an xlsx buffer into raw string matrices.
   *
   * The method preserves the full grid including the header row and empty
   * cells, making it suitable for downstream consumers (e.g. LLM prompts)
   * that need an exact textual representation of the workbook.
   *
   * - Date cells are normalized to UTC `YYYY-MM-DD` to avoid timezone drift
   *   on bank data.
   * - The buffer is rejected before parsing when its zip container would
   *   expand past a sane bound (zip bomb).
   */
  async parseToMatrix(buffer: Buffer): Promise<XlsxSheetMatrix[]> {
    this.assertReasonableZipVolume(buffer);

    const workbook = new ExcelJS.Workbook();
    // exceljs pins an older @types/node whose Buffer structurally differs from
    // the host's generic Buffer<T>; the runtime value is a plain Node Buffer.
    await workbook.xlsx.load(buffer as unknown as never);

    return workbook.worksheets.map((sheet) => {
      const matrix: string[][] = [];
      const { rowCount, columnCount } = sheet;
      for (let r = 1; r <= rowCount; r += 1) {
        const row: string[] = [];
        for (let c = 1; c <= columnCount; c += 1) {
          row.push(this.cellToString(sheet.getCell(r, c).value));
        }
        matrix.push(row);
      }
      return { sheetName: sheet.name, rows: matrix };
    });
  }

  /**
   * Convert a single ExcelJS cell value to its textual representation.
   *
   * Handles the cell value shapes exceljs can produce: scalars, Date values
   * (date-typed cells), hyperlink objects, formula results and rich text.
   */
  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      // { text, hyperlink }
      if ("text" in value && typeof (value as { text?: unknown }).text === "string") {
        return (value as { text: string }).text;
      }
      // { formula, result } — fall through to the computed result
      if ("result" in value) {
        return this.cellToString((value as { result: ExcelJS.CellValue }).result);
      }
      // { richText: Array<{ text }> }
      const rich = (value as { richText?: unknown }).richText;
      if (Array.isArray(rich)) {
        return rich
          .map((segment) =>
            segment && typeof segment === "object" && "text" in segment
              ? String((segment as { text?: unknown }).text ?? "")
              : "",
          )
          .join("");
      }
      return "";
    }
    return String(value);
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
}
