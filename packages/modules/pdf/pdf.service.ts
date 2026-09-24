import {Injectable} from '@nestjs/common';
import * as path from 'node:path';
import {ensureDir, readdir, readFileSync, remove} from 'fs-extra';
import {PDFDocument, PDFPageDrawTextOptions} from 'pdf-lib';
import {fromBuffer} from 'pdf2pic';

const TEMP_PDF2PIC_DIR = path.join(process.cwd(), 'temp/pdf2pic');

@Injectable()
export class PdfService {
  async drawTextOnPage(params: {
    pdfPath: string;
    pdfPage: number;
    texts: {text: string; options: PDFPageDrawTextOptions}[];
  }) {
    const pdfBytes = readFileSync(params.pdfPath, 'utf8');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(params.pdfPage - 1);

    for (let i = 0; i < params.texts.length; i++) {
      page.drawText(params.texts[i].text, params.texts[i].options);
    }

    return await pdfDoc.save();
  }

  async convertToImages(params: {buffer: Buffer}) {
    try {
      // Set up save path
      const savePath = path.join(TEMP_PDF2PIC_DIR, `${Date.now()}`);

      // Ensure the directory exists, if not, create it.
      await ensureDir(savePath);

      // Create pdf2pic converter
      const options = {
        quality: undefined,
        format: 'jpg', // format of the output image
        width: 596,
        height: 842,
        density: 100,
        savePath,
        saveFilename: 'pic', // prefix for output file names
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
      return fileNames.map(fileName => path.join(savePath, fileName));
    } catch (error) {
      console.error('PDF conversion to images failed: ' + error.message);
      return [];
    }
  }

  async removeTempImages() {
    try {
      await remove(TEMP_PDF2PIC_DIR);
    } catch (error) {
      console.error('Remove temp images error:', error);
    }
  }

  // Get PDF page count
  private async getPdfPageCount(buffer: Buffer): Promise<number> {
    try {
      // 这里使用pdf2pic的方式获取页数
      // 注意：pdf2pic本身不直接提供获取页数的方法，这里是一个简化实现
      // 实际项目中可能需要使用其他PDF库如pdf-lib或pdf.js来获取页数
      const convert = fromBuffer(buffer, {density: 100, format: 'jpg'});
      const info = await convert.bulk(-1, {responseType: 'buffer'});
      return info.length || 1; // 如果无法获取页数，默认为1页
    } catch (error) {
      console.error('获取PDF页数出错：', error);
      return 1; // 出错时默认为1页
    }
  }
}
