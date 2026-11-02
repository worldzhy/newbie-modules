import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { launch, PDFOptions } from "puppeteer";

@Injectable()
export class PuppeteerService {
  private readonly logger = new Logger(PuppeteerService.name);
  private config: { chromiumPath: string; noSandbox: boolean };

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow("modules.puppeteer");
  }

  private launchArgs(): string[] {
    // --no-sandbox is required in containerized environments where the kernel
    // user-namespace sandbox is unavailable. It is configurable so hosts that
    // can run Chromium with the sandbox enabled (native, rootless containers)
    // can opt out by setting PUPPETEER_NO_SANDBOX=false.
    return this.config.noSandbox ? ["--no-sandbox"] : [];
  }

  async renderHtmlToImage(html: string, viewport?: { width: number; height: number }) {
    const browser = await launch({
      executablePath: this.config.chromiumPath,
      args: this.launchArgs(),
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
      args: this.launchArgs(),
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
