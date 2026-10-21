/** Match a whole storage key prefix, including after the storage column's separators. */
export function folderFilterValue(prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ignoreCase = /^[a-z]:[\\/]/i.test(prefix) ? "(?i)" : "";
  return `${ignoreCase}(?:^|;)${escaped}`;
}
