import {createHash} from 'node:crypto';

/**
 * Computes a stable error fingerprint used to group equivalent errors.
 *
 * Inputs: error type + normalized message + the first stack frame that belongs
 * to application code (frames under node:internal/ or node_modules/ are
 * skipped, so framework/runtime churn does not change the fingerprint).
 * Numbers in the message and frame are masked so timestamps/ids do not split a
 * group. Returns the first 16 hex chars of a sha1 hash. The algorithm is
 * deliberately simple and may be replaced later (the column stores the value
 * only, no semantic dependency).
 */
export function computeErrorFingerprint(type: string, message: string, stack?: string): string {
  const normalizedMessage = message
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const businessFrame = extractTopBusinessFrame(stack);

  return createHash('sha1')
    .update(`${type}|${normalizedMessage}|${businessFrame}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Returns the first stack trace frame outside runtime/framework code, with its
 * line and column numbers masked. Empty string when no such frame exists.
 */
function extractTopBusinessFrame(stack?: string): string {
  if (!stack) return '';
  const frame = stack
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('at ') && !/node:internal|node_modules/.test(line));
  // Mask numeric positions (line:column, embedded ids) but keep the file path.
  return frame ? frame.replace(/:\d+/g, ':#') : '';
}
