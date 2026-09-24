import {Injectable} from '@nestjs/common';
import {Express} from 'express';
import * as XLSX from 'xlsx';

/** Raw content of a single worksheet: its name plus a matrix of string cell values. */
export interface XlsxSheetMatrix {
  sheetName: string;
  rows: string[][];
}

@Injectable()
export class XLSXService {
  private workbook: XLSX.WorkBook;

  createWorkbook() {
    this.workbook = XLSX.utils.book_new();
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
   * - SheetJS emits false-positive "Bad uncompressed size" messages via
   *   console.error for zip entries using CRC data descriptors (common in files
   *   written by WPS Office); inflate still succeeds and data is correct. Only
   *   that specific message is filtered, other errors remain visible.
   */
  parseToMatrix(buffer: Buffer): XlsxSheetMatrix[] {
    // Filter SheetJS's false-positive size warning while keeping real errors visible.
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = () => {};
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('Bad uncompressed size:')) return;
      originalError.apply(console, args);
    };

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {type: 'buffer', cellDates: true});
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    return workbook.SheetNames.map(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      // header:1 returns raw row arrays; defval:'' fills empty cells.
      const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
      });
      const rows: string[][] = rawRows.map(row =>
        (row as unknown[]).map(cell => (cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? '')))
      );
      return {sheetName, rows};
    });
  }

  getSheets(): string[] {
    return this.workbook.SheetNames;
  }

  //**********************/
  //* Load file          */
  //**********************/

  loadLocalFile(filePath: string) {
    this.workbook = XLSX.readFile(filePath);
  }

  loadFile(file: Express.Multer.File) {
    this.workbook = XLSX.read(file.buffer);
  }

  loadBuffer(buffer: Buffer) {
    this.workbook = XLSX.read(buffer);
  }

  //************************/
  //* Get columns and rows */
  //************************/

  getColumnsBySheetIndex(index: number): string[] {
    const sheet = this.workbook.Sheets[this.workbook.SheetNames[index]];

    return this.getColumns(sheet);
  }

  getColumnsBySheetName(name: string): string[] {
    const sheet = this.workbook.Sheets[name];

    return this.getColumns(sheet);
  }

  getRowsBySheetIndex(index: number): object[] {
    const sheet = this.workbook.Sheets[this.workbook.SheetNames[index]];
    return this.getRows(sheet);
  }

  getRowsBySheetName(name: string): object[] {
    const sheet = this.workbook.Sheets[name];
    return this.getRows(sheet);
  }

  //**********************/
  //* Save file          */
  //**********************/

  writeFile(fileName: string) {
    XLSX.writeFile(this.workbook, fileName);
  }

  //**********************/
  //* Private operations */
  //**********************/

  private getColumns(sheet: XLSX.WorkSheet): string[] {
    const columns: string[] = [];

    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const startRow = range.s.r; // start in the first row

      // walk every column in the range
      for (let C = range.s.c; C <= range.e.c; ++C) {
        let column = 'UNKNOWN ' + C; // <-- replace with your desired default

        const cell = sheet[XLSX.utils.encode_cell({c: C, r: startRow})]; // find the cell in the first row
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
