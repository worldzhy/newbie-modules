import type {
  CopilotChartBlock,
  CopilotErrorBlock,
  CopilotQueryBlock,
  CopilotSkillBlock,
  CopilotTableBlock,
} from "./agent-events";

/**
 * Bounded emission of skill result blocks (FR-7, NFR-2). Everything crossing
 * the SSE boundary is capped: chart points, table rows, and the serialized
 * size of the whole block array. Cuts are marked with `truncated: true` on
 * the affected block so the UI can show the marker (Task 5).
 */

export const CHART_POINT_CAP = 500;
export const TABLE_ROW_CAP = 100;
export const BLOCKS_SERIALIZED_CAP_BYTES = 64 * 1024;

type KnownBlockKind =
  CopilotChartBlock["kind"] | CopilotTableBlock["kind"] | CopilotQueryBlock["kind"] | CopilotErrorBlock["kind"];

/**
 * Narrows a block to one of the kernel-known shapes. Custom blocks carry a
 * free-form `kind: string`, so a plain `===` check cannot exclude them from a
 * literal-kind narrow; this guard keeps the known shapes fully typed.
 */
function knownKind<K extends KnownBlockKind>(
  block: CopilotSkillBlock,
  kind: K,
): block is Extract<CopilotSkillBlock, { kind: K }> {
  return block.kind === kind;
}

function capChart(block: Extract<CopilotSkillBlock, { kind: "chart" }>): CopilotSkillBlock {
  if (block.labels.length <= CHART_POINT_CAP) return block;
  return {
    ...block,
    labels: block.labels.slice(0, CHART_POINT_CAP),
    datasets: block.datasets.map((dataset) => ({ ...dataset, data: dataset.data.slice(0, CHART_POINT_CAP) })),
    truncated: true,
  };
}

function capTable(block: Extract<CopilotSkillBlock, { kind: "table" }>): CopilotSkillBlock {
  if (block.rows.length <= TABLE_ROW_CAP) return block;
  return { ...block, rows: block.rows.slice(0, TABLE_ROW_CAP), truncated: true };
}

function serializedSize(blocks: CopilotSkillBlock[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(blocks), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Caps every block and then, when the whole array still exceeds the
 * serialized budget, drops trailing blocks and marks the new tail as
 * truncated. Deterministic: query/error blocks sit last, so data blocks are
 * dropped first only when they follow a large head block.
 */
export function boundBlocks(blocks: CopilotSkillBlock[]): CopilotSkillBlock[] {
  let bounded = blocks.map((block) => {
    if (knownKind(block, "chart")) return capChart(block);
    if (knownKind(block, "table")) return capTable(block);
    // Custom blocks pass through uncapped: the kernel does not know their
    // shape, so per-block capping is the host's responsibility. They still
    // count towards the serialized budget below.
    return block;
  });

  while (bounded.length > 1 && serializedSize(bounded) > BLOCKS_SERIALIZED_CAP_BYTES) {
    bounded = bounded.slice(0, -1);
  }
  if (bounded.length === 1 && serializedSize(bounded) > BLOCKS_SERIALIZED_CAP_BYTES) {
    bounded = [shrinkToFit(bounded[0])];
  } else if (bounded.length < blocks.length && bounded.length > 0) {
    const tail = bounded[bounded.length - 1];
    bounded = [...bounded.slice(0, -1), { ...tail, truncated: true } as CopilotSkillBlock];
  }
  return bounded;
}

const TITLE_CAP = 1024;

/** Halve the payload of a single oversized block until it fits the budget. */
function shrinkToFit(block: CopilotSkillBlock): CopilotSkillBlock {
  let current: CopilotSkillBlock = { ...block, truncated: true };
  for (let attempts = 0; attempts < 32 && serializedSize([current]) > BLOCKS_SERIALIZED_CAP_BYTES; attempts += 1) {
    if (knownKind(current, "table") && current.rows.length > 1) {
      current = { ...current, rows: current.rows.slice(0, Math.ceil(current.rows.length / 2)) };
      continue;
    }
    if (knownKind(current, "chart") && current.labels.length > 1) {
      const half = Math.ceil(current.labels.length / 2);
      current = {
        ...current,
        labels: current.labels.slice(0, half),
        datasets: current.datasets.map((dataset) => ({ ...dataset, data: dataset.data.slice(0, half) })),
      };
      continue;
    }
    if (knownKind(current, "query") && current.sql.length > TITLE_CAP) {
      current = { ...current, sql: current.sql.slice(0, Math.ceil(current.sql.length / 2)) };
      continue;
    }
    // Payload already minimal; the oversize lives in titles/strings. Custom
    // blocks get the same generic title trim when they carry a string title;
    // beyond that the kernel cannot shrink a shape it does not know, so the
    // block is returned as-is (same best-effort semantics as error blocks).
    const title: unknown = current.title;
    if (typeof title === "string" && title.length > TITLE_CAP) {
      current = { ...current, title: title.slice(0, TITLE_CAP) };
      continue;
    }
    if (knownKind(current, "table")) {
      current = {
        ...current,
        rows: [],
        columns: current.columns.map((c) => ({ ...c, header: c.header.slice(0, TITLE_CAP) })),
      };
      continue;
    }
    break;
  }
  return current;
}

/**
 * Audit summary for copilot.skill_call (FR-7): template id, block count, and
 * per-block shape/row-point counts. Block payloads are never logged.
 */
export function summarizeBlocks(blocks: CopilotSkillBlock[]): string {
  const templateId = blocks.find((block) => knownKind(block, "query"))?.templateId;
  const parts = blocks.map((block) => {
    if (knownKind(block, "chart")) return `chart:${block.chartType}(${block.labels.length}pt)`;
    if (knownKind(block, "table")) return `table(${block.rows.length}/${block.totalRows} rows)`;
    if (block.kind === "query") return "query";
    if (block.kind === "error") return "error";
    // Custom block: the kernel knows nothing beyond the kind string.
    return `${block.kind}(custom)`;
  });
  return `${blocks.length} block(s)${templateId ? ` template=${templateId}` : ""}: ${parts.join(", ")}`;
}
