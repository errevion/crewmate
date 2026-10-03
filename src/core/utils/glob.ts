/**
 * Simple, zero-dependency glob pattern matching for file paths.
 * Supports * (single segment wildcard) and ** (recursive wildcard).
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").trim();
  const normalizedPath = filePath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();

  // Escape regex special chars except *
  let regexStr = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    if (normalizedPattern.slice(i, i + 2) === "**") {
      // Globstar matches across directories
      if (normalizedPattern[i + 2] === "/") {
        regexStr += "(?:.*\\/)?";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (normalizedPattern[i] === "*") {
      // Single star matches within a single segment (no /)
      regexStr += "[^\\/]*";
      i += 1;
    } else {
      const char = normalizedPattern[i];
      if (/[.+^$(){}|[\]\\]/.test(char)) {
        regexStr += "\\" + char;
      } else {
        regexStr += char;
      }
      i += 1;
    }
  }

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}
