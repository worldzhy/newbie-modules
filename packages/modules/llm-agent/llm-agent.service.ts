import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { LLMProviderFactory } from "./providers/provider.factory";
import { LLMMessage } from "./providers/llm-provider.interface";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class LlmAgentService {
  private readonly logger = new Logger(LlmAgentService.name);

  constructor(
    private readonly providerFactory: LLMProviderFactory,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log("LlmAgentService initialized");
  }

  /**
   * Generic LLM completion primitive. This is the single public entry point for callers
   * that need to talk to the currently active model; all prompt/domain logic lives with the caller.
   */
  async callLLM(messages: LLMMessage[], jsonMode: boolean = false, tools: any[] = []): Promise<any> {
    try {
      // Always get the provider right before calling, in case it was switched dynamically
      const provider = await this.providerFactory.getProvider();
      return await provider.call(messages, { jsonMode, tools });
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(`Error calling LLM: ${errorMessage}`, error?.stack);
      throw error;
    }
  }

  async getAvailableProviders() {
    return await this.providerFactory.getAvailableProviders();
  }

  /**
   * Mask an API key for all outbound responses, exposing only the last 4 characters.
   * Internal provider construction reads the raw key straight from the DB and never passes through here.
   */
  private maskApiKey<T extends { apiKey: string }>(model: T): T {
    return { ...model, apiKey: model.apiKey ? "********" + model.apiKey.slice(-4) : "" };
  }

  async getCurrentProvider() {
    return await this.providerFactory.getCurrentProviderId();
  }

  async switchProvider(providerId: string) {
    await this.providerFactory.switchProvider(providerId);
    return { success: true, currentProvider: providerId };
  }

  // --- LLM Models Management ---

  async getModels() {
    const models = await this.prisma.llmModel.findMany({
      orderBy: { createdAt: "asc" },
    });
    // Mask API keys for security before returning to frontend
    return models.map((m) => this.maskApiKey(m));
  }

  async createModel(dto: any) {
    // If it's the first model, make it active
    const count = await this.prisma.llmModel.count();
    const isActive = count === 0;

    const dataToCreate = { ...dto, isActive };
    if (dataToCreate.version === "") {
      dataToCreate.version = null;
    }

    return this.maskApiKey(
      await this.prisma.llmModel.create({
        data: dataToCreate,
      }),
    );
  }

  async updateModel(id: string, dto: any) {
    const dataToUpdate = { ...dto };

    // If the apiKey comes in as masked, don't update it
    if (dataToUpdate.apiKey && dataToUpdate.apiKey.startsWith("********")) {
      delete dataToUpdate.apiKey;
    }

    if (dataToUpdate.version === "") {
      dataToUpdate.version = null;
    }

    return this.maskApiKey(
      await this.prisma.llmModel.update({
        where: { id },
        data: dataToUpdate,
      }),
    );
  }

  async deleteModel(id: string) {
    const model = await this.prisma.llmModel.findUnique({ where: { id } });
    if (model?.isActive) {
      throw new BadRequestException("Cannot delete the currently active model. Switch to another model first.");
    }
    return this.maskApiKey(
      await this.prisma.llmModel.delete({
        where: { id },
      }),
    );
  }

  async testModel(id: string) {
    const model = await this.prisma.llmModel.findUnique({ where: { id } });
    if (!model) {
      throw new BadRequestException("Model not found");
    }

    try {
      // Test without modifying the active state in DB
      const provider = await this.providerFactory.createProviderInstance(model);
      const response = await provider.call([{ role: "user", content: "ping" }]);

      if (response && response.content) {
        return { success: true, message: "Connection successful" };
      } else {
        return { success: false, message: "No content received from model" };
      }
    } catch (error: any) {
      throw new BadRequestException(`Connection failed: ${error.message}`);
    }
  }
}
