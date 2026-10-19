import { Injectable, OnModuleInit, RequestMethod } from "@nestjs/common";
import { PATH_METADATA, REQUEST_METHOD_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { NextFunction, Request, Response } from "express";
import { PUBLIC_CORS_KEY } from "./public-cors.decorator";

/** Headers a browser may send to a public report endpoint (Bearer standard + legacy private headers during the migration window). */
const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Heartbeat-Token",
  "X-Health-Token",
  "X-Backend-Monitor-Token",
  "X-Module-Hub-Token",
].join(", ");

const REQUEST_METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
};

/**
 * Registry of the routes decorated with @PublicCors(), built once at module
 * init from controller metadata. The static surface lets the Express-level
 * beforeCors hook in main.ts consult it without touching the Nest container
 * (the hook is registered before the app finishes initializing).
 *
 * Access-Control-Allow-Origin: * is safe on these routes only because they
 * authenticate via a secret token, never via cookies/JWT — see ADR-016.
 */
@Injectable()
export class PublicCorsService implements OnModuleInit {
  /** normalized path -> declared HTTP methods (uppercase). */
  private static readonly routes = new Map<string, Set<string>>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const controllerPath = this.reflector.get<string | undefined>(PATH_METADATA, metatype) ?? "";
      const prototype = Object.getPrototypeOf(instance) as object;
      const methodNames = Array.from(this.metadataScanner.getAllMethodNames(prototype)).filter(
        (name): name is string => typeof name === "string",
      );
      for (const name of methodNames) {
        const handler = prototype[name as keyof typeof prototype] as (...args: unknown[]) => unknown;
        const isPublicCors = this.reflector.getAllAndOverride<boolean>(PUBLIC_CORS_KEY, [handler, metatype]);
        if (!isPublicCors) continue;
        const methodMetadata = this.reflector.get<RequestMethod | undefined>(REQUEST_METHOD_METADATA, handler);
        if (methodMetadata === undefined) continue;
        const methodPath = this.reflector.get<string | undefined>(PATH_METADATA, handler) ?? "";
        const path = PublicCorsService.normalizePath(`${controllerPath}/${methodPath}`);
        const method = REQUEST_METHOD_NAMES[methodMetadata];
        if (!method) continue;
        const methods = PublicCorsService.routes.get(path) ?? new Set<string>();
        methods.add(method);
        PublicCorsService.routes.set(path, methods);
      }
    }
  }

  /**
   * Exact (case-insensitive) match against the @PublicCors registry.
   * OPTIONS/HEAD match any registered path so preflight is answered.
   */
  static isPublicCorsRoute(method: string, path: string): boolean {
    const methods = PublicCorsService.routes.get(PublicCorsService.normalizePath(path));
    if (!methods) return false;
    if (method === "OPTIONS" || method === "HEAD") return true;
    return methods.has(method.toUpperCase());
  }

  /**
   * Express-level CORS handler for @PublicCors routes, wired as the
   * beforeCors hook in main.ts. Sets ACAO:* and answers OPTIONS preflight;
   * non-matching requests pass through untouched.
   */
  static handleRequest(req: Request, res: Response, next: NextFunction): void {
    if (!PublicCorsService.isPublicCorsRoute(req.method, req.path)) {
      next();
      return;
    }
    const methods = PublicCorsService.routes.get(PublicCorsService.normalizePath(req.path));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", [...(methods ?? []), "OPTIONS"].join(", "));
    res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  }

  private static normalizePath(path: string): string {
    const normalized = `/${path}`.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
    return normalized === "" ? "/" : normalized;
  }
}
