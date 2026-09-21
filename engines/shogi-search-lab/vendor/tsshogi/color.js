export var Color = /*#__PURE__*/ function(Color) {
    Color["BLACK"] = "black";
    Color["WHITE"] = "white";
    return Color;
}({});
export function reverseColor(color) {
    return color === "black" ? "white" : "black";
}
export function colorToSFEN(color) {
    return color === "black" ? "b" : "w";
}
export function isValidSFENColor(sfen) {
    return sfen === "b" || sfen === "w";
}
export function parseSFENColor(sfen) {
    return sfen === "b" ? "black" : "white";
}
