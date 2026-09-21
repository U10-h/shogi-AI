import { appendLine } from "./helpers/string.js";
import { millisecondsToHHMMSS, millisecondsToMSS } from "./helpers/time.js";
import { Board } from "./board.js";
import { Color } from "./color.js";
import { InvalidBoardError, InvalidDestinationError, InvalidHandPieceError, InvalidLineError, InvalidMoveError, InvalidMoveNumberError } from "./errors.js";
import { Hand } from "./hand.js";
import { Move, SpecialMoveType, anySpecialMove, isKnownSpecialMove, specialMove } from "./move.js";
import { Piece, PieceType } from "./piece.js";
import { InitialPositionSFEN, Position } from "./position.js";
import { Record, RecordMetadata, RecordMetadataKey } from "./record.js";
import { Square } from "./square.js";
import { fileToMultiByteChar, formatMove, numberToKanji, parseMoves, pieceTypeToStringForBoard, pieceTypeToStringForMove, rankToKanji, stringToNumber, stringToPieceType } from "./text.js";
export var KakinokiFormatType = /*#__PURE__*/ function(KakinokiFormatType) {
    KakinokiFormatType["KIF"] = "KIF";
    KakinokiFormatType["KI2"] = "KI2";
    return KakinokiFormatType;
}({});
const metadataKeyMap = {
    先手: RecordMetadataKey.BLACK_NAME,
    後手: RecordMetadataKey.WHITE_NAME,
    下手: RecordMetadataKey.SHITATE_NAME,
    上手: RecordMetadataKey.UWATE_NAME,
    開始日時: RecordMetadataKey.START_DATETIME,
    終了日時: RecordMetadataKey.END_DATETIME,
    対局日: RecordMetadataKey.DATE,
    棋戦: RecordMetadataKey.TOURNAMENT,
    戦型: RecordMetadataKey.STRATEGY,
    表題: RecordMetadataKey.TITLE,
    持ち時間: RecordMetadataKey.TIME_LIMIT,
    秒読み: RecordMetadataKey.BYOYOMI,
    消費時間: RecordMetadataKey.TIME_SPENT,
    場所: RecordMetadataKey.PLACE,
    掲載: RecordMetadataKey.POSTED_ON,
    備考: RecordMetadataKey.NOTE,
    先手省略名: RecordMetadataKey.BLACK_SHORT_NAME,
    後手省略名: RecordMetadataKey.WHITE_SHORT_NAME,
    記録係: RecordMetadataKey.SCOREKEEPER,
    作品番号: RecordMetadataKey.OPUS_NO,
    作品名: RecordMetadataKey.OPUS_NAME,
    作者: RecordMetadataKey.AUTHOR,
    発表誌: RecordMetadataKey.PUBLISHED_BY,
    発表年月: RecordMetadataKey.PUBLISHED_AT,
    出典: RecordMetadataKey.SOURCE,
    手数: RecordMetadataKey.LENGTH,
    完全性: RecordMetadataKey.INTEGRITY,
    分類: RecordMetadataKey.CATEGORY,
    受賞: RecordMetadataKey.AWARD,
    先手持ち時間: RecordMetadataKey.BLACK_TIME_LIMIT,
    後手持ち時間: RecordMetadataKey.WHITE_TIME_LIMIT,
    最大手数: RecordMetadataKey.MAX_MOVES,
    持将棋: RecordMetadataKey.JISHOGI
};
export function kakinokiToMetadataKey(key) {
    return metadataKeyMap[key];
}
const metadataNameMap = {
    [RecordMetadataKey.BLACK_NAME]: "先手",
    [RecordMetadataKey.WHITE_NAME]: "後手",
    [RecordMetadataKey.SHITATE_NAME]: "下手",
    [RecordMetadataKey.UWATE_NAME]: "上手",
    [RecordMetadataKey.START_DATETIME]: "開始日時",
    [RecordMetadataKey.END_DATETIME]: "終了日時",
    [RecordMetadataKey.DATE]: "対局日",
    [RecordMetadataKey.TOURNAMENT]: "棋戦",
    [RecordMetadataKey.STRATEGY]: "戦型",
    [RecordMetadataKey.TITLE]: "表題",
    [RecordMetadataKey.TIME_LIMIT]: "持ち時間",
    [RecordMetadataKey.BYOYOMI]: "秒読み",
    [RecordMetadataKey.TIME_SPENT]: "消費時間",
    [RecordMetadataKey.PLACE]: "場所",
    [RecordMetadataKey.POSTED_ON]: "掲載",
    [RecordMetadataKey.NOTE]: "備考",
    [RecordMetadataKey.BLACK_SHORT_NAME]: "先手省略名",
    [RecordMetadataKey.WHITE_SHORT_NAME]: "後手省略名",
    [RecordMetadataKey.SCOREKEEPER]: "記録係",
    [RecordMetadataKey.OPUS_NO]: "作品番号",
    [RecordMetadataKey.OPUS_NAME]: "作品名",
    [RecordMetadataKey.AUTHOR]: "作者",
    [RecordMetadataKey.PUBLISHED_BY]: "発表誌",
    [RecordMetadataKey.PUBLISHED_AT]: "発表年月",
    [RecordMetadataKey.SOURCE]: "出典",
    [RecordMetadataKey.LENGTH]: "手数",
    [RecordMetadataKey.INTEGRITY]: "完全性",
    [RecordMetadataKey.CATEGORY]: "分類",
    [RecordMetadataKey.AWARD]: "受賞",
    [RecordMetadataKey.BLACK_TIME_LIMIT]: "先手持ち時間",
    [RecordMetadataKey.WHITE_TIME_LIMIT]: "後手持ち時間",
    [RecordMetadataKey.MAX_MOVES]: "最大手数",
    [RecordMetadataKey.JISHOGI]: "持将棋"
};
export function metadataKeyToKakinoki(key) {
    return metadataNameMap[key];
}
var LineType = /*#__PURE__*/ function(LineType) {
    LineType[LineType["PROGRAM_COMMENT"] = 0] = "PROGRAM_COMMENT";
    LineType[LineType["METADATA"] = 1] = "METADATA";
    LineType[LineType["HANDICAP"] = 2] = "HANDICAP";
    LineType[LineType["BLACK_HAND"] = 3] = "BLACK_HAND";
    LineType[LineType["WHITE_HAND"] = 4] = "WHITE_HAND";
    LineType[LineType["BOARD"] = 5] = "BOARD";
    LineType[LineType["BLACK_TURN"] = 6] = "BLACK_TURN";
    LineType[LineType["WHITE_TURN"] = 7] = "WHITE_TURN";
    LineType[LineType["MOVE"] = 8] = "MOVE";
    LineType[LineType["MOVE2"] = 9] = "MOVE2";
    LineType[LineType["BRANCH"] = 10] = "BRANCH";
    LineType[LineType["COMMENT"] = 11] = "COMMENT";
    LineType[LineType["BOOKMARK"] = 12] = "BOOKMARK";
    LineType[LineType["END_OF_GAME"] = 13] = "END_OF_GAME";
    LineType[LineType["UNKNOWN"] = 14] = "UNKNOWN";
    return LineType;
}(LineType || {});
const linePatterns = [
    {
        prefix: /^#/,
        type: 0,
        removePrefix: false,
        isPosition: false
    },
    {
        prefix: /^手合割[：:]/,
        type: 2,
        removePrefix: true,
        isPosition: true
    },
    {
        prefix: /^(先|下)手の持駒[：:]/,
        type: 3,
        removePrefix: true,
        isPosition: true
    },
    {
        prefix: /^(後|上)手の持駒[：:]/,
        type: 4,
        removePrefix: true,
        isPosition: true
    },
    {
        prefix: /^\|/,
        type: 5,
        removePrefix: false,
        isPosition: true
    },
    {
        prefix: /^(先|下)手番/,
        type: 6,
        removePrefix: false,
        isPosition: true
    },
    {
        prefix: /^(後|上)手番/,
        type: 7,
        removePrefix: false,
        isPosition: true
    },
    {
        prefix: /^ *[0-9]+ +/,
        type: 8,
        removePrefix: false,
        isPosition: false
    },
    {
        prefix: /^[ \u3000]*[▲△▼▽☗☖]/,
        type: 9,
        removePrefix: false,
        isPosition: false
    },
    {
        prefix: /^[ \u3000]*変化[：:][ \u3000]*/,
        type: 10,
        removePrefix: true,
        isPosition: false
    },
    {
        prefix: /^\*/,
        type: 11,
        removePrefix: true,
        isPosition: false
    },
    {
        prefix: /^&/,
        type: 12,
        removePrefix: true,
        isPosition: false
    },
    {
        prefix: /^まで、?([0-9]+手で)?/,
        type: 13,
        removePrefix: true,
        isPosition: false
    }
];
function parseLine(line) {
    for(let i = 0; i < linePatterns.length; i++){
        const pattern = linePatterns[i];
        const matched = line.match(pattern.prefix);
        if (matched) {
            const begin = pattern.removePrefix ? matched[0].length : 0;
            return {
                type: pattern.type,
                data: line.substring(begin),
                isPosition: pattern.isPosition,
                metadataKey: ""
            };
        }
    }
    const metadataPrefix = line.match(/^[^ ：:]+[：:]/);
    if (metadataPrefix) {
        const prefix = metadataPrefix[0];
        return {
            type: 1,
            data: line.substring(prefix.length),
            isPosition: false,
            metadataKey: prefix.substring(0, prefix.length - 1)
        };
    }
    return {
        type: 14,
        data: line,
        isPosition: false,
        metadataKey: ""
    };
}
function readHandicap(position, data) {
    switch(data.trim()){
        case "平手":
            position.resetBySFEN(InitialPositionSFEN.STANDARD);
            return;
        case "香落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_LANCE);
            return;
        case "右香落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_RIGHT_LANCE);
            return;
        case "角落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_BISHOP);
            return;
        case "飛車落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_ROOK);
            return;
        case "飛香落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_ROOK_LANCE);
            return;
        case "二枚落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_2PIECES);
            return;
        case "四枚落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_4PIECES);
            return;
        case "六枚落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_6PIECES);
            return;
        case "八枚落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_8PIECES);
            return;
        case "十枚落ち":
            position.resetBySFEN(InitialPositionSFEN.HANDICAP_10PIECES);
            return;
        case "その他":
            position.resetBySFEN(InitialPositionSFEN.EMPTY);
            return;
    }
}
const stringToSpecialMoveType = {
    中断: SpecialMoveType.INTERRUPT,
    投了: SpecialMoveType.RESIGN,
    持将棋: SpecialMoveType.IMPASS,
    千日手: SpecialMoveType.REPETITION_DRAW,
    詰み: SpecialMoveType.MATE,
    詰: SpecialMoveType.MATE,
    不詰: SpecialMoveType.NO_MATE,
    切れ負け: SpecialMoveType.TIMEOUT,
    反則勝ち: SpecialMoveType.FOUL_WIN,
    反則負け: SpecialMoveType.FOUL_LOSE,
    入玉勝ち: SpecialMoveType.ENTERING_OF_KING,
    不戦勝: SpecialMoveType.WIN_BY_DEFAULT,
    不戦敗: SpecialMoveType.LOSE_BY_DEFAULT
};
const moveRegExp = /^ *([0-9]+) +[▲△▼▽]?([１２３４５６７８９][一二三四五六七八九]|同\u3000*)(王|玉|飛|龍|竜|角|馬|金|銀|成銀|全|桂|成桂|圭|香|成香|杏|歩|と)\u3000*(成?)(打|\([1-9][1-9]\)) *([^ ].*|$)/;
const timeRegExp = /\( *([0-9]+):([0-9]+)\/[0-9: ]*\)/;
const specialMoveRegExp = /^ *([0-9]+) +([^ \u3000]+) *([^ ].*|$)/;
const branchRegExp = /^ *([0-9]+)/;
function readBoard(board, data) {
    if (data.length < 21) {
        return new InvalidBoardError(data);
    }
    const rankStr = data[20];
    const rank = stringToNumber(rankStr);
    if (!rank) {
        return new InvalidBoardError(data);
    }
    for(let x = 0; x < 9; x += 1){
        const file = 9 - x;
        const square = new Square(file, rank);
        const index = x * 2 + 1;
        const pieceStr = data[index + 1];
        const pieceType = stringToPieceType(pieceStr);
        if (!pieceType) {
            board.remove(square);
            continue;
        }
        const color = data[index] !== "v" ? Color.BLACK : Color.WHITE;
        board.set(square, new Piece(color, pieceType));
    }
}
function readHand(hand, data) {
    const sections = data.split(/[ 　]/);
    for (const section of sections){
        if (!section || section === "なし") {
            continue;
        }
        const pieceStr = section[0];
        const numberStr = section.substring(1);
        const pieceType = stringToPieceType(pieceStr);
        const n = stringToNumber(numberStr) || 1;
        if (!pieceType) {
            return new InvalidHandPieceError(section);
        }
        hand.add(pieceType, n);
    }
    return;
}
function readMoveTime(record, data) {
    const timeResult = timeRegExp.exec(data);
    if (timeResult) {
        const minutes = timeResult[1];
        const seconds = timeResult[2];
        const s = Number.parseInt(minutes) * 60 + Number.parseInt(seconds);
        record.current.setElapsedMs(s * 1e3);
    }
}
function readMove(record, data) {
    const result = readRegularMove(record, data);
    if (result instanceof Error) {
        return result;
    } else if (result) {
        return;
    }
    if (readSpecialMove(record, data)) {
        return;
    }
    return new InvalidMoveError(data);
}
function readRegularMove(record, data) {
    const result = moveRegExp.exec(data);
    if (!result) {
        return false;
    }
    const num = Number(result[1]);
    const toStr = result[2];
    const pieceTypeStr = result[3];
    const promStr = result[4];
    const fromStr = result[5];
    const time = result[6];
    if (num === 0) {
        return new InvalidMoveNumberError(data);
    }
    record.goto(num - 1);
    let to;
    let from;
    if (toStr.startsWith("同")) {
        if (!(record.current.move instanceof Move)) {
            return new InvalidDestinationError(data);
        }
        to = record.current.move.to;
    } else {
        const file = stringToNumber(toStr[0]);
        const rank = stringToNumber(toStr[1]);
        to = new Square(file, rank);
    }
    if (fromStr === "打") {
        from = stringToPieceType(pieceTypeStr);
    } else {
        const file = stringToNumber(fromStr[1]);
        const rank = stringToNumber(fromStr[2]);
        from = new Square(file, rank);
    }
    let move = record.position.createMove(from, to);
    if (!move) {
        return new InvalidMoveError(data);
    }
    if (promStr === "成") {
        move = move.withPromote();
    }
    record.append(move, {
        ignoreValidation: true
    });
    readMoveTime(record, time);
    return true;
}
function readSpecialMove(record, data) {
    const result = specialMoveRegExp.exec(data);
    if (!result) {
        return false;
    }
    const num = Number(result[1]);
    const type = stringToSpecialMoveType[result[2]];
    const time = result[3];
    record.goto(num - 1);
    let move;
    if (type) {
        move = specialMove(type);
    } else {
        move = anySpecialMove(result[2]);
    }
    record.append(move, {
        ignoreValidation: true
    });
    readMoveTime(record, time);
    return true;
}
function readMove2(record, data) {
    const lastMove = record.current.move instanceof Move ? record.current.move : undefined;
    const [moves, e] = parseMoves(record.position, data, lastMove);
    if (e) {
        return e;
    }
    for (const move of moves){
        record.append(move, {
            ignoreValidation: true
        });
    }
}
function readBranch(record, data) {
    const result = branchRegExp.exec(data);
    if (!result) {
        return new InvalidMoveNumberError(data);
    }
    const num = Number(result[1]);
    if (num === 0 || num > record.current.ply + 1) {
        return new InvalidMoveNumberError(data);
    }
    record.goto(num - 1);
}
function readEndOfGame(record, data) {
    const clean = data.replaceAll(/[\s\u3000]/g, "");
    if (clean.startsWith("時間切れ")) {
        record.append(specialMove(SpecialMoveType.TIMEOUT));
    } else if (clean.endsWith("反則勝ち")) {
        record.append(specialMove(SpecialMoveType.FOUL_WIN));
    } else if (clean.endsWith("反則負け")) {
        record.append(specialMove(SpecialMoveType.FOUL_LOSE));
    } else if (clean.endsWith("入玉勝ち")) {
        record.append(specialMove(SpecialMoveType.ENTERING_OF_KING));
    } else if (clean.endsWith("勝ち")) {
        record.append(specialMove(SpecialMoveType.RESIGN));
    } else {
        const type = stringToSpecialMoveType[clean];
        if (type) {
            record.append(specialMove(type));
        } else {
            record.append(anySpecialMove(clean));
        }
    }
}
export function importKIF(data) {
    return importKakinoki(data, "KIF");
}
export function importKI2(data) {
    return importKakinoki(data, "KI2");
}
function importKakinoki(data, formatType) {
    const metadata = new RecordMetadata();
    const record = new Record();
    const lines = data.split(/\r?\n/);
    const position = new Position();
    let preMoveComment = "";
    let preMoveBookmark = "";
    let isMoveSection = false;
    const startMoveSectionIfNot = ()=>{
        if (isMoveSection) {
            return;
        }
        record.clear(position);
        record.first.comment = preMoveComment;
        record.first.bookmark = preMoveBookmark;
        isMoveSection = true;
    };
    for (const line of lines){
        if (line === "") {
            continue;
        }
        const parsed = parseLine(line);
        if (isMoveSection && parsed.isPosition) {
            return new InvalidLineError(line);
        }
        let e;
        switch(parsed.type){
            case 1:
                {
                    const standardKey = metadataKeyMap[parsed.metadataKey];
                    if (standardKey) {
                        metadata.setStandardMetadata(standardKey, parsed.data);
                    } else {
                        metadata.setCustomMetadata(parsed.metadataKey, parsed.data);
                    }
                    break;
                }
            case 2:
                readHandicap(position, parsed.data);
                break;
            case 3:
                e = readHand(position.blackHand, parsed.data);
                break;
            case 4:
                e = readHand(position.whiteHand, parsed.data);
                break;
            case 5:
                e = readBoard(position.board, parsed.data);
                break;
            case 6:
                position.setColor(Color.BLACK);
                break;
            case 7:
                position.setColor(Color.WHITE);
                break;
            case 8:
                if (formatType !== "KIF") {
                    return new InvalidLineError(line);
                }
                startMoveSectionIfNot();
                e = readMove(record, parsed.data);
                break;
            case 9:
                if (formatType !== "KI2") {
                    return new InvalidLineError(line);
                }
                startMoveSectionIfNot();
                e = readMove2(record, parsed.data);
                break;
            case 10:
                if (isMoveSection && formatType === "KI2") {
                    e = readBranch(record, parsed.data);
                }
                break;
            case 11:
                if (isMoveSection) {
                    record.current.comment = appendLine(record.current.comment, parsed.data);
                } else {
                    preMoveComment = appendLine(preMoveComment, parsed.data);
                }
                break;
            case 12:
                if (isMoveSection) {
                    record.current.bookmark = parsed.data;
                } else {
                    preMoveBookmark = parsed.data;
                }
                break;
            case 13:
                if (formatType === "KI2") {
                    startMoveSectionIfNot();
                    readEndOfGame(record, parsed.data);
                }
                break;
            case 0:
                break;
            case 14:
                break;
        }
        if (e) {
            return e;
        }
    }
    startMoveSectionIfNot();
    record.goto(0);
    record.resetAllBranchSelection();
    record.metadata = metadata;
    return record;
}
const specialMoveToString = {
    [SpecialMoveType.START]: "",
    [SpecialMoveType.RESIGN]: "投了",
    [SpecialMoveType.INTERRUPT]: "中断",
    [SpecialMoveType.MAX_MOVES]: "持将棋",
    [SpecialMoveType.IMPASS]: "持将棋",
    [SpecialMoveType.DRAW]: "持将棋",
    [SpecialMoveType.REPETITION_DRAW]: "千日手",
    [SpecialMoveType.MATE]: "詰み",
    [SpecialMoveType.NO_MATE]: "不詰",
    [SpecialMoveType.TIMEOUT]: "切れ負け",
    [SpecialMoveType.FOUL_WIN]: "反則勝ち",
    [SpecialMoveType.FOUL_LOSE]: "反則負け",
    [SpecialMoveType.ENTERING_OF_KING]: "入玉勝ち",
    [SpecialMoveType.WIN_BY_DEFAULT]: "不戦勝",
    [SpecialMoveType.LOSE_BY_DEFAULT]: "不戦敗",
    [SpecialMoveType.TRY]: "トライ"
};
function formatMetadata(metadata, options) {
    let ret = "";
    const returnCode = options?.returnCode || "\n";
    for (const key of metadata.standardMetadataKeys){
        ret += metadataNameMap[key] + "：" + metadata.getStandardMetadata(key) + returnCode;
    }
    for (const key of metadata.customMetadataKeys){
        ret += key + "：" + metadata.getCustomMetadata(key) + returnCode;
    }
    return ret;
}
function formatPosition(position, options) {
    const returnCode = options?.returnCode || "\n";
    switch(position.sfen){
        case InitialPositionSFEN.STANDARD:
            return "手合割：平手" + returnCode;
        case InitialPositionSFEN.HANDICAP_LANCE:
            return "手合割：香落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_RIGHT_LANCE:
            return "手合割：右香落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_BISHOP:
            return "手合割：角落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_ROOK:
            return "手合割：飛車落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_ROOK_LANCE:
            return "手合割：飛香落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_2PIECES:
            return "手合割：二枚落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_4PIECES:
            return "手合割：四枚落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_6PIECES:
            return "手合割：六枚落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_8PIECES:
            return "手合割：八枚落ち" + returnCode;
        case InitialPositionSFEN.HANDICAP_10PIECES:
            return "手合割：十枚落ち" + returnCode;
    }
    return formatBOD(position, options);
}
function formatBOD(position, options) {
    const returnCode = options?.returnCode || "\n";
    let ret = "";
    ret += "後手の持駒：" + formatHand(position.whiteHand) + returnCode;
    ret += "  ９ ８ ７ ６ ５ ４ ３ ２ １" + returnCode;
    ret += "+---------------------------+" + returnCode;
    for(let y = 0; y < 9; y++){
        ret += "|";
        for(let x = 0; x < 9; x++){
            const square = Square.newByXY(x, y);
            const piece = position.board.at(square);
            if (!piece) {
                ret += " ・";
            } else if (piece.color === Color.BLACK) {
                ret += " " + pieceTypeToStringForBoard(piece.type);
            } else {
                ret += "v" + pieceTypeToStringForBoard(piece.type);
            }
        }
        ret += "|" + rankToKanji(y + 1) + returnCode;
    }
    ret += "+---------------------------+" + returnCode;
    ret += "先手の持駒：" + formatHand(position.blackHand) + returnCode;
    if (position.color === Color.BLACK) {
        ret += "先手番" + returnCode;
    } else {
        ret += "後手番" + returnCode;
    }
    return ret;
}
export function formatKIFMove(move, options) {
    let ret = "";
    if (options?.prev && move.to.equals(options.prev.to)) {
        ret += "同\u3000";
    } else {
        ret += fileToMultiByteChar(move.to.file);
        ret += rankToKanji(move.to.rank);
    }
    ret += pieceTypeToStringForMove(move.pieceType);
    if (move.promote) {
        ret += "成";
    }
    if (move.from instanceof Square) {
        ret += "(" + move.from.file + move.from.rank + ")";
        ret += ret.length === 7 && options?.padding ? "  " : "";
    } else {
        ret += "打";
        ret += options?.padding ? "    " : "";
    }
    return ret;
}
function formatHand(hand) {
    let ret = "";
    hand.forEach((pieceType, n)=>{
        if (n >= 1) {
            ret += pieceTypeToStringForBoard(pieceType);
            if (n >= 2) {
                ret += numberToKanji(n);
            }
            ret += "　";
        }
    });
    if (ret === "") {
        ret = "なし";
    }
    return ret;
}
export function exportKIF(record, options) {
    let ret = "";
    const returnCode = options?.returnCode || "\n";
    if (options?.comment) {
        for (const line of options.comment.split("\n")){
            ret += "#" + line + returnCode;
        }
    }
    ret += formatMetadata(record.metadata, options);
    ret += formatPosition(record.initialPosition, options);
    ret += "手数----指手---------消費時間--" + returnCode;
    record.forEach((node)=>{
        if (node.ply !== 0) {
            if (!node.isFirstBranch) {
                ret += returnCode;
                ret += "変化：" + node.ply + "手" + returnCode;
            }
            ret += String(node.ply).padStart(4, " ") + " ";
            if (node.move instanceof Move) {
                const prev = node.prev?.move instanceof Move ? node.prev.move : undefined;
                ret += formatKIFMove(node.move, {
                    prev,
                    padding: true
                });
            } else if (isKnownSpecialMove(node.move)) {
                const s = specialMoveToString[node.move.type];
                ret += s + " ".repeat(Math.max(12 - s.length * 2, 0));
            } else {
                ret += node.move.name + " ".repeat(Math.max(12 - node.move.name.length * 2, 0));
            }
            const elapsed = millisecondsToMSS(node.elapsedMs);
            const totalElapsed = millisecondsToHHMMSS(node.totalElapsedMs);
            ret += ` (${elapsed}/${totalElapsed})`;
            if (node.branch) {
                ret += "+";
            }
            ret += returnCode;
        }
        if (node.comment.length !== 0) {
            const comment = node.comment.endsWith("\n") ? node.comment.slice(0, -1) : node.comment;
            ret += "*" + comment.replaceAll("\n", returnCode + "*") + returnCode;
        }
        if (node.bookmark.length !== 0) {
            ret += "&" + node.bookmark + returnCode;
        }
    });
    return ret;
}
export function exportKI2(record, options) {
    let ret = "";
    let moveCountInLine = 0;
    let lastMoveLength = 0;
    const returnCode = options?.returnCode ? options.returnCode : "\n";
    ret += formatMetadata(record.metadata, options);
    ret += formatPosition(record.initialPosition, options);
    record.forEach((node)=>{
        if (node.prev) {
            if (!node.isFirstBranch) {
                if (!ret.endsWith(returnCode)) {
                    ret += returnCode;
                }
                ret += returnCode;
                ret += "変化：" + node.ply + "手" + returnCode;
            }
            if (node.move instanceof Move) {
                const pos = Position.newBySFEN(node.prev.sfen);
                if (!pos) {
                    throw new Error("Invalid SFEN");
                }
                const str = formatMove(pos, node.move, {
                    lastMove: node.prev?.move instanceof Move ? node.prev.move : undefined,
                    compatible: true
                });
                if (ret.endsWith(returnCode)) {
                    moveCountInLine = 0;
                } else {
                    ret += " ".repeat(Math.max(12 - lastMoveLength * 2, 0));
                }
                ret += str;
                lastMoveLength = str.length;
                moveCountInLine++;
                if (moveCountInLine >= 6) {
                    ret += returnCode;
                }
            } else {
                if (!ret.endsWith(returnCode)) {
                    ret += returnCode;
                }
                ret += `まで${node.ply - 1}手で`;
                if (isKnownSpecialMove(node.move)) {
                    const [next, last] = node.nextColor === Color.BLACK ? [
                        "先手",
                        "後手"
                    ] : [
                        "後手",
                        "先手"
                    ];
                    switch(node.move.type){
                        case SpecialMoveType.RESIGN:
                            ret += `${last}の勝ち`;
                            break;
                        case SpecialMoveType.TIMEOUT:
                            ret += `時間切れにより${last}の勝ち`;
                            break;
                        case SpecialMoveType.ENTERING_OF_KING:
                            ret += `${next}の入玉勝ち`;
                            break;
                        case SpecialMoveType.FOUL_WIN:
                            ret += `${next}の反則勝ち`;
                            break;
                        case SpecialMoveType.FOUL_LOSE:
                            ret += `${next}の反則負け`;
                            break;
                        default:
                            ret += specialMoveToString[node.move.type];
                            break;
                    }
                } else {
                    ret += node.move.name;
                }
                ret += returnCode;
            }
        }
        if (node.comment.length !== 0) {
            if (!ret.endsWith(returnCode)) {
                ret += returnCode;
            }
            const comment = node.comment.endsWith("\n") ? node.comment.slice(0, -1) : node.comment;
            ret += "*" + comment.replaceAll("\n", returnCode + "*") + returnCode;
        }
        if (node.bookmark.length !== 0) {
            if (!ret.endsWith(returnCode)) {
                ret += returnCode;
            }
            ret += "&" + node.bookmark + returnCode;
        }
    });
    return ret;
}
export function exportBOD(record, options) {
    let ret = "";
    const returnCode = options?.returnCode || "\n";
    ret += formatBOD(record.position, options);
    const ply = record.current.ply;
    const lastMove = record.current.move instanceof Move ? record.current.move : undefined;
    const lastMoveStr = lastMove ? formatKIFMove(lastMove) : "";
    ret += `手数＝${ply}  ${lastMoveStr}  まで` + returnCode;
    return ret;
}
