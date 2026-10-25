import { Injectable, Logger } from "@nestjs/common";

/// Business modules declare the events they emit at startup. The catalog is
/// the baseline of "which events should exist"; the EventEmission log records
/// what actually fired, including emissions nobody declared.
export interface EventDeclaration {
  key: string;
  name?: string;
  description?: string;
  payloadExample?: unknown;
}

@Injectable()
export class EventCatalogService {
  private readonly logger = new Logger(EventCatalogService.name);
  private readonly declarations = new Map<string, EventDeclaration>();

  declareEvent(declaration: EventDeclaration): void {
    if (this.declarations.has(declaration.key)) {
      throw new Error(`Event is already declared: ${declaration.key}`);
    }
    this.declarations.set(declaration.key, declaration);
    this.logger.log(`Event declared: ${declaration.key}`);
  }

  listDeclarations(): EventDeclaration[] {
    return [...this.declarations.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}
