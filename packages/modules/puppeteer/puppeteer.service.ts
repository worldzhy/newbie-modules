import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { launch, PDFOptions } from "puppeteer";

/// --no-sandbox is required in every supported runtime (containerized hosts
/// where the kernel user-namespace sandbox is unavailable), so it is not a
/// configuration switch (ADR-033).
const LAUNCH_ARGS = ["--no-sandbox"];

@Injectable()
export class PuppeteerService {
  private readonly logger = new Logger(PuppeteerService.name);
  private config: { chromiumPath: string };

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow("modules.puppeteer");
  }

  async renderHtmlToImage(html: string, viewport?: { width: number; height: number }) {
    const browser = await launch({
      executablePath: this.config.chromiumPath,
      args: LAUNCH_ARGS,
    });
    try {
      const page = await browser.newPage();
      if (viewport) await page.setViewport(viewport);
      await page.setContent(html, { waitUntil: "networkidle2" });
      return await page.screenshot({ encoding: "binary" });
    } finally {
      await browser.close().catch((e) => this.logger.error("Failed to close puppeteer browser:", e.message));
    }
  }

  async renderHtmlToPdf(html: string, viewport?: { width: number; height: number }, options?: PDFOptions) {
    const browser = await launch({
      executablePath: this.config.chromiumPath,
      args: LAUNCH_ARGS,
    });
    try {
      const page = await browser.newPage();
      if (viewport) await page.setViewport(viewport);
      await page.setContent(html, { waitUntil: "networkidle2" });
      return await page.pdf(options);
    } finally {
      await browser.close().catch((e) => this.logger.error("Failed to close puppeteer browser:", e.message));
    }
  }
}
