const TASK_CODE_PATTERN = /^D[1-9]\d{0,5}A[1-9]\d{0,5}$/u;
const PROJECT_NAME_MAX_CODE_POINTS = 120;

function sanitizeQuotedArgument(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/["\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized)
    .slice(0, PROJECT_NAME_MAX_CODE_POINTS)
    .join("")
    .trim();
}

/**
 * Build display-only copy for the future MCP loop. This is deliberately not a
 * parser, tool call, or authentication claim; the UI labels it as an example.
 */
export function buildFutureMcpCommandExample(
  projectName: string,
  actionDisplayCode: string | undefined,
): string | null {
  const taskCode = actionDisplayCode?.normalize("NFKC").trim().toUpperCase() ?? "";
  if (!TASK_CODE_PATTERN.test(taskCode)) return null;

  const safeProjectName = sanitizeQuotedArgument(projectName) || "Project Name";
  return `/causent pull context -project "${safeProjectName}" -task ${taskCode}`;
}
