#!/usr/bin/env node
/**
 * One-off (and reusable) importer for the newbie-modules registry.
 *
 * For every legacy standalone module repository (https://github.com/worldzhy/newbie.<key>.git)
 * it clones the repository into a temp directory and lays the module out under
 * `packages/modules/<key>/`:
 *
 *   packages/modules/<key>/
 *   ├── newbie.module.json   # manifest: wiring + env/dependencies/assets/config
 *   ├── prisma/schema.prisma # optional Prisma model fragment (from <key>.schema)
 *   └── <module sources>     # every file from the legacy repo except .git/.newbie
 *
 * Usage:
 *   node scripts/import-modules.mjs            # clone every module
 *   node scripts/import-modules.mjs account saas
 *   node scripts/import-modules.mjs --refresh  # overwrite existing module dirs
 *
 * Requires git and network access. Node 18+ (no third-party dependencies).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REGISTRY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MODULES_DIR = path.join(REGISTRY_ROOT, "packages", "modules");

/**
 * Catalog of the legacy repositories. `file`/`className` mirror the old
 * microservices.constants.js NestJS wiring metadata; they cannot be derived
 * from the repository contents (a few class names are irregular).
 *
 * `schema`/`settings` declare whether the legacy `.newbie/` bundle contains
 * `<key>.schema` / `<key>.settings.json`.
 */
const MODULES = [
  { key: "saas", file: "saas", className: "SaasModule" },
  { key: "account", file: "account", className: "AccountModule" },
  { key: "aws-audit", file: "aws-audit", className: "AwsAuditModule" },
  {
    key: "aws-cloudwatch",
    file: "aws-cloudwatch",
    className: "AwsCloudwatchModule",
  },
  { key: "aws-core", file: "aws-core", className: "AwsCoreModule" },
  { key: "aws-s3", file: "aws-s3", className: "AwsS3Module" },
  {
    key: "aws-secrets-manager",
    file: "aws-secrets-manager",
    className: "AwsSecretsManagerModule",
  },
  { key: "aws-ses", file: "aws-ses", className: "AwsSesModule", schema: false },
  { key: "aws-sms", file: "aws-sms", className: "AwsSmsModule", schema: false },
  { key: "aws-sqs", file: "aws-sqs", className: "AwsSqsModule", schema: false },
  {
    key: "cache",
    file: "cache",
    className: "NewbieCacheModule",
    schema: false,
  },
  {
    key: "clickhouse",
    file: "clickhouse",
    className: "ClickhouseModule",
    schema: false,
  },
  {
    key: "cloudformation",
    file: "cloudformation",
    className: "AwsCloudformationModule",
  },
  {
    key: "cloudinary",
    file: "cloudinary",
    className: "CloudinaryModule",
    schema: false,
  },
  {
    key: "elasticsearch",
    file: "elasticsearch",
    className: "ElasticsearchModule",
    schema: false,
  },
  {
    key: "engined",
    file: "engined",
    className: "EnginedModule",
    settings: false,
  },
  {
    key: "event-scheduling",
    file: "event-scheduling",
    className: "EventSchedulingModule",
  },
  {
    key: "frontend-monitor",
    file: "frontend-monitor",
    className: "FrontendMonitorModule",
    schema: false,
  },
  { key: "github", file: "github", className: "GitHubModule", schema: false },
  { key: "googleapis", file: "googleapis", className: "GoogleAPIsModule" },
  { key: "googlemaps", file: "googlemaps", className: "GoogleMapsModule" },
  {
    key: "lark-bot",
    file: "lark-bot",
    className: "LarkBotModule",
    schema: false,
    settings: false,
  },
  {
    key: "llm-agent",
    file: "llm-agent",
    className: "LlmAgentModule",
    settings: false,
  },
  {
    key: "local-storage",
    file: "local-storage",
    className: "LocalStorageModule",
  },
  { key: "map", file: "map", className: "MapModule", settings: false },
  {
    key: "membership",
    file: "membership",
    className: "MembershipModule",
    settings: false,
  },
  { key: "message-bot", file: "message-bot", className: "MessageBotModule" },
  {
    key: "message-tracker",
    file: "message-tracker",
    className: "MessageTrackerModule",
  },
  { key: "mongo", file: "mongo", className: "MongoModule", schema: false },
  {
    key: "notification",
    file: "notification",
    className: "NotificationModule",
  },
  { key: "order", file: "order", className: "OrderModule" },
  {
    key: "organization",
    file: "organization",
    className: "OrganizationModule",
    settings: false,
  },
  { key: "pdf", file: "pdf", className: "PdfModule", schema: false },
  {
    key: "people-finder",
    file: "people-finder",
    className: "PeopleFinderModule",
  },
  {
    key: "puppeteer",
    file: "puppeteer",
    className: "PuppeteerModule",
    schema: false,
  },
  { key: "queue", file: "queue", className: "NewbieQueueModule" },
  {
    key: "shortcut",
    file: "shortcut",
    className: "ShortcutModule",
    settings: false,
  },
  { key: "slack", file: "slack", className: "SlackModule", schema: false },
  {
    key: "snowflake",
    file: "snowflake",
    className: "SnowflakeModule",
    schema: false,
  },
  {
    key: "stock-mgmt",
    file: "stock-mgmt",
    className: "StockManagementModule",
    settings: false,
  },
  { key: "tag", file: "tag", className: "TagModule", settings: false },
  {
    key: "task-scheduling",
    file: "task-scheduling",
    className: "TaskSchedulingModule",
  },
  {
    key: "task-management",
    file: "task-management",
    className: "TaskManagementModule",
    settings: false,
  },
  { key: "tencent-cos", file: "tencent-cos", className: "TencentCosModule" },
  { key: "webhook", file: "webhook", className: "WebhookModule" },
  {
    key: "workflow",
    file: "workflow",
    className: "WorkflowModule",
    settings: false,
  },
  { key: "xlsx", file: "xlsx", className: "XLSXModule", schema: false },
];

/** Files/directories of the legacy repositories that never get imported. */
const IGNORE_ENTRIES = new Set([".git", ".newbie"]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

async function copyTree(source, target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (IGNORE_ENTRIES.has(entry.name)) continue;
    await fs.cp(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
    });
  }
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The legacy fragments pin models to the old multi-schema namespace via
 * `@@schema("microservice/<key>")`. The registry copy model uses
 * `module/<key>`, so rewrite every occurrence (plus the banner comment).
 */
function moderniseSchemaFragment(fragment) {
  return fragment
    .replace(/@@schema\((\s*)"microservice\//g, '@@schema($1"module/')
    .replace(/\[Microservice\]/g, "[Module]");
}

/**
 * Legacy module repositories use three project-local import styles from the
 * template era:
 * - `@framework/<subpath>` — now the `@devbie/newbie` package, which exposes
 *   the same subpath layout via its "./*" export map;
 * - `@microservices/<key>/<subpath>` — assembled modules now live under
 *   `src/modules/<key>/`, aliased as `@modules/<key>/<subpath>`;
 * - relative `../../framework/<subpath>` — the same framework sources reached
 *   by walking up to the legacy monorepo root instead of using an alias;
 * - relative `../../microservices/<key>/<subpath>` — cross-module imports via
 *   the legacy directory name rather than the `@modules` alias.
 */
async function moderniseImportAliases(target) {
  // Plain recursive walk (Dirent.path from recursive readdir is not portable
  // across Node versions).
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const content = await fs.readFile(file, "utf8");
        const next = content
          .replace(/(['"])@framework\//g, "$1@devbie/newbie/")
          .replace(/(['"])@microservices\//g, "$1@modules/")
          .replace(/(['"])(?:\.\.\/)+framework\//g, "$1@devbie/newbie/")
          .replace(/(['"])(?:\.\.\/)+microservices\//g, "$1@modules/");
        if (next !== content) await fs.writeFile(file, next, "utf8");
      }
    }
  }
  await walk(target);
}

/** Build newbie.module.json from the legacy <key>.settings.json bundle. */
function buildManifest(meta, settings, hasSchema) {
  const manifest = {
    key: meta.key,
    module: { file: `${meta.file}.module`, className: meta.className },
  };
  if (hasSchema) manifest.schema = "prisma/schema.prisma";
  if (settings && typeof settings === "object") {
    for (const [key, value] of Object.entries(settings)) {
      manifest[key] = value;
    }
  }
  return manifest;
}

async function importModule(meta, refresh) {
  const target = path.join(MODULES_DIR, meta.key);
  if (
    !refresh &&
    (await fs
      .stat(target)
      .then(() => true)
      .catch(() => false))
  ) {
    console.info(
      `skip ${meta.key} (already imported; pass --refresh to overwrite)`,
    );
    return;
  }

  const url = `https://github.com/worldzhy/newbie.${meta.key}.git`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `newbie-${meta.key}-`));
  try {
    process.stdout.write(`clone ${meta.key}...`);
    git(["clone", "--quiet", url, tmp]);
    const sourceCommit = git(["-C", tmp, "rev-parse", "HEAD"]);

    const expectsSettings = meta.settings !== false;
    const expectsSchema = meta.schema !== false;
    const settingsFile = path.join(tmp, ".newbie", `${meta.key}.settings.json`);
    const schemaFile = path.join(tmp, ".newbie", `${meta.key}.schema`);

    const settings = expectsSettings
      ? await readOptionalJson(settingsFile)
      : null;
    if (expectsSettings && settings === null) {
      console.warn(
        `\n[warn] ${meta.key}: expected .newbie/${meta.key}.settings.json but it is missing`,
      );
    }
    let schema = null;
    if (expectsSchema) {
      try {
        schema = await fs.readFile(schemaFile, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") {
          console.warn(
            `\n[warn] ${meta.key}: expected .newbie/${meta.key}.schema but it is missing`,
          );
        } else {
          throw error;
        }
      }
    }

    await copyTree(tmp, target);
    await moderniseImportAliases(target);
    if (schema !== null) {
      await fs.mkdir(path.join(target, "prisma"), { recursive: true });
      await fs.writeFile(
        path.join(target, "prisma", "schema.prisma"),
        moderniseSchemaFragment(schema),
        "utf8",
      );
    }
    await fs.writeFile(
      path.join(target, "newbie.module.json"),
      `${JSON.stringify(buildManifest(meta, settings, schema !== null), null, 2)}\n`,
      "utf8",
    );
    console.info(` done @${sourceCommit.slice(0, 7)}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const keys = args.filter((arg) => !arg.startsWith("--"));
  const selected =
    keys.length > 0
      ? MODULES.filter((meta) => keys.includes(meta.key))
      : MODULES;
  const unknown = keys.filter(
    (key) => !MODULES.some((meta) => meta.key === key),
  );
  if (unknown.length > 0) {
    console.error(`Unknown module key(s): ${unknown.join(", ")}`);
    process.exit(1);
  }

  await fs.mkdir(MODULES_DIR, { recursive: true });
  for (const meta of selected) {
    await importModule(meta, refresh);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
