import { Position } from "./position.js";
export var RecordFormatType = /*#__PURE__*/ function(RecordFormatType) {
    RecordFormatType[RecordFormatType["USI"] = 0] = "USI";
    RecordFormatType[RecordFormatType["SFEN"] = 1] = "SFEN";
    RecordFormatType[RecordFormatType["KIF"] = 2] = "KIF";
    RecordFormatType[RecordFormatType["KI2"] = 3] = "KI2";
    RecordFormatType[RecordFormatType["CSA"] = 4] = "CSA";
    RecordFormatType[RecordFormatType["JKF"] = 5] = "JKF";
    RecordFormatType[RecordFormatType["USEN"] = 6] = "USEN";
    return RecordFormatType;
}({});
export function detectRecordFormat(data) {
    if (data === "position startpos" || data === "startpos" || data.startsWith("position sfen ") || data.startsWith("position startpos ") || data.startsWith("sfen ") || data.startsWith("startpos ") || data.startsWith("moves ")) {
        return 0;
    }
    if (Position.isValidSFEN(data)) {
        return 1;
    }
    if (/^[\s\r\n]*{/.test(data) && /}[\s\r\n]*$/.test(data)) {
        return 5;
    }
    if (/^[-_.A-Za-z0-9]*~[0-9]*\.[0-9A-Za-z]*\.[a-z]?(~|$)/.test(data)) {
        return 6;
    }
    const pattKIF = /(^|\n)[ \u3000]*[#0-9開終棋手戦表持秒記消場掲備先後作発出完分受]/g;
    const pattKI2 = /(^|\n)[ \u3000]*[#▲△▼▽☗☖開終棋手戦表持秒記消場掲備先後作発出完分受]/g;
    const pattCSA = /(^|,|\n)[-+$%'VNPT]/g;
    const matchedKIF = data.match(pattKIF);
    const matchedKI2 = data.match(pattKI2);
    const matchedCSA = data.match(pattCSA);
    const evalKIF = matchedKIF?.length || 0;
    const evalKI2 = matchedKI2?.length || 0;
    const evalCSA = matchedCSA?.length || 0;
    return evalKIF >= evalCSA && evalKIF >= evalKI2 ? 2 : evalKI2 >= evalCSA ? 3 : 4;
}
