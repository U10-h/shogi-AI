export function appendLine(base, newLine) {
    return (base ? appendReturnIfNotExists(base) : "") + appendReturnIfNotExists(newLine);
}
export function appendReturnIfNotExists(str) {
    return str + (str.endsWith("\n") ? "" : "\n");
}
