import { Injectable } from "@nestjs/common";
import * as path from "node:path";
import { ensureDir, readdir, readFileSync, remove } from "fs-extra";
import { PDFDocument, PDFPageDrawTextOptions } from "pdf-lib";
import { fromBuffer } from "pdf2pic";

const TEMP_PDF2PIC_DIR = path.join(process.cwd(), "temp/pdf2pic");

@Injectable()
export class PdfService {
  async drawTextOnPage(params: {
    pdfPath: string;
    pdfPage: number;
    texts: { text: string; options: PDFPageDrawTextOptions }[];
  }) {
    const pdfBytes = readFileSync(params.pdfPath, "utf8");
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
      console.error("PDF conversion to images failed: " + error.message);
      return [];
    }
  }

  async removeTempImages() {
    try {
      await remove(TEMP_PDF2PIC_DIR);
    } catch (error) {
      console.error("Remove temp images error:", error);
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
      console.error("Failed to get PDF page count:", error);
      return 1; // Fall back to 1 page on error
    }
  }
}
