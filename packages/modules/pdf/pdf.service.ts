import { Injectable, Logger } from "@nestjs/common";
import * as path from "node:path";
import { ensureDir, readdir, readFileSync, remove } from "fs-extra";
import { PDFDocument, PDFPageDrawTextOptions } from "pdf-lib";
import { fromBuffer } from "pdf2pic";

const TEMP_PDF2PIC_DIR = path.join(process.cwd(), "temp/pdf2pic");

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  async drawTextOnPage(params: {
    pdfPath: string;
    pdfPage: number;
    texts: { text: string; options: PDFPageDrawTextOptions }[];
  }) {
    // PDFs are binary; reading with the default encoding corrupts the bytes.
    const pdfBytes = readFileSync(params.pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(params.pdfPage - 1);

    for (let i = 0; i < params.texts.length; i++) {
      page.drawText(params.texts[i].text, params.texts[i].options);
    }

    return await pdfDoc.save();
  }

  async convertToImages(params: { buffer: Buffer }) {
    try {
      // Set up save path
      const savePath = path.join(TEMP_PDF2PIC_DIR, `${Date.now()}`);

      // Ensure the directory exists, if not, create it.
      await ensureDir(savePath);

      // Create pdf2pic converter
      const options = {
        quality: undefined,
        format: "jpg", // format of the output image
        width: 596,
        height: 842,
        density: 100,
        savePath,
        saveFilename: "pic", // prefix for output file names
      };
      const convert = fromBuffer(params.buffer, options);

      // Get PDF page count
      const pageCount = await this.getPdfPageCount(params.buffer);

      // Convert each page to image
      for (let i = 1; i <= pageCount; i++) {
        await convert(i);
      }

      // Return array of image paths
      const fileNames = await readdir(savePath);
      return fileNames.map((fileName) => path.join(savePath, fileName));
    } catch (error) {
      this.logger.error("PDF conversion to images failed: " + (error instanceof Error ? error.message : String(error)));
      return [];
    }
  }

  async removeTempImages() {
    try {
      await remove(TEMP_PDF2PIC_DIR);
    } catch (error) {
      this.logger.error("Remove temp images error:", error instanceof Error ? error.message : String(error));
    }
  }

  // Get PDF page count
  private async getPdfPageCount(buffer: Buffer): Promise<number> {
    try {
      // Get the page count via pdf2pic
      // Note: pdf2pic does not provide a direct page-count API; this is a simplified implementation
      // In a real project, another PDF library such as pdf-lib or pdf.js may be needed to get the page count
      const convert = fromBuffer(buffer, { density: 100, format: "jpg" });
      const info = await convert.bulk(-1, { responseType: "buffer" });
      return info.length || 1; // Fall back to 1 page when the count cannot be obtained
    } catch (error) {
      this.logger.error("Failed to get PDF page count:", error instanceof Error ? error.message : String(error));
      return 1; // Fall back to 1 page on error
    }
  }
}
