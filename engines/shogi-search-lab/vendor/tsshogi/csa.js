import { appendLine } from "./helpers/string.js";
import { InvalidLineError, InvalidMoveError, InvalidPieceNameError, InvalidTurnError, PieceNotExistsError } from "./errors.js";
import { Color } from "./color.js";
import "./hand.js";
import { anySpecialMove, Move, specialMove, SpecialMoveType } from "./move.js";
import { Piece, PieceType, promotedPieceType } from "./piece.js";
import { Position, countNotExistingPieces, InitialPositionSFEN } from "./position.js";
import { Record, RecordMetadata, RecordMetadataKey, getBlackPlayerName, getWhitePlayerName } from "./record.js";
import { Square } from "./square.js";
var LineType = /*#__PURE__*/ function(LineType) {
    LineType[LineType["VERSION"] = 0] = "VERSION";
    LineType[LineType["EXTENDED_COMMENT"] = 1] = "EXTENDED_COMMENT";
    LineType[LineType["COMMENT"] = 2] = "COMMENT";
    LineType[LineType["BLACK_NAME"] = 3] = "BLACK_NAME";
    LineType[LineType["WHITE_NAME"] = 4] = "WHITE_NAME";
    LineType[LineType["METADATA"] = 5] = "METADATA";
    LineType[LineType["POSITION"] = 6] = "POSITION";
    LineType[LineType["RANK"] = 7] = "RANK";
    LineType[LineType["PIECES"] = 8] = "PIECES";
    LineType[LineType["FIRST_TURN"] = 9] = "FIRST_TURN";
    LineType[LineType["MOVE"] = 10] = "MOVE";
    LineType[LineType["SPECIAL_MOVE"] = 11] = "SPECIAL_MOVE";
    LineType[LineType["ELAPSED"] = 12] = "ELAPSED";
    return LineType;
}(LineType || {});
var SectionType = /*#__PURE__*/ function(SectionType) {
    SectionType[SectionType["HEADER"] = 0] = "HEADER";
    SectionType[SectionType["MOVE"] = 1] = "MOVE";
    SectionType[SectionType["NEUTRAL"] = 2] = "NEUTRAL";
    return SectionType;
}(SectionType || {});
const linePatterns = [
    {
        pattern: /^V/,
        type: 0,
        sectionType: 0
    },
    {
        pattern: /^'\*(.+)$/,
        type: 1,
        sectionType: 2
    },
    {
        pattern: /^'(.+)$/,
        type: 2,
        sectionType: 2
    },
    {
        pattern: /^N\+(.+)$/,
        type: 3,
        sectionType: 0
    },
    {
        pattern: /^N-(.+)$/,
        type: 4,
        sectionType: 0
    },
    {
        pattern: /^\$([^:]+):(.+)$/,
        type: 5,
        sectionType: 0
    },
    {
        pattern: /^PI([1-9]{2}[A-Z]{2})*$/,
        type: 6,
        sectionType: 0
    },
    {
        pattern: /^P[1-9]( \* ?|[-+][A-Z][A-Z]){9}$/,
        type: 7,
        sectionType: 0
    },
    {
        pattern: /^P[-+]([0-9]{2}[A-Z]{2})*/,
        type: 8,
        sectionType: 0
    },
    {
        pattern: /^[-+]$/,
        type: 9,
        sectionType: 0
    },
    {
        pattern: /^[-+][0-9]{4}[A-Z]{2}/,
        type: 10,
        sectionType: 1
    },
    {
        pattern: /^%[-+A-Z_]+/,
        type: 11,
        sectionType: 1
    },
    {
        pattern: /^T([0-9]+(?:\.[0-9]*)?)/,
        type: 12,
        sectionType: 1
    }
];
function parseLine(line) {
    const results = [];
    const lines = /^['N$]/.test(line) ? [
        line
    ] : line.split(",");
    for (const line of lines){
        for(let i = 0; i < linePatterns.length; i++){
            const matched = linePatterns[i].pattern.exec(line);
            if (matched) {
                results.push({
                    type: linePatterns[i].type,
                    line: line,
                    args: matched.slice(1),
                    sectionType: linePatterns[i].sectionType
                });
                break;
            }
        }
    }
    return results;
}
const csaNameToRecordMetadataKey = {
    EVENT: RecordMetadataKey.TITLE,
    SITE: RecordMetadataKey.PLACE,
    START_TIME: RecordMetadataKey.START_DATETIME,
    END_TIME: RecordMetadataKey.END_DATETIME,
    TIME_LIMIT: RecordMetadataKey.TIME_LIMIT,
    TIME: RecordMetadataKey.TIME_LIMIT,
    "TIME+": RecordMetadataKey.BLACK_TIME_LIMIT,
    "TIME-": RecordMetadataKey.WHITE_TIME_LIMIT,
    OPENING: RecordMetadataKey.STRATEGY,
    MAX_MOVES: RecordMetadataKey.MAX_MOVES,
    JISHOGI: RecordMetadataKey.JISHOGI,
    NOTE: RecordMetadataKey.NOTE
};
const csaNameToPieceType = {
    FU: PieceType.PAWN,
    KY: PieceType.LANCE,
    KE: PieceType.KNIGHT,
    GI: PieceType.SILVER,
    KI: PieceType.GOLD,
    KA: PieceType.BISHOP,
    HI: PieceType.ROOK,
    OU: PieceType.KING,
    TO: PieceType.PROM_PAWN,
    NY: PieceType.PROM_LANCE,
    NK: PieceType.PROM_KNIGHT,
    NG: PieceType.PROM_SILVER,
    UM: PieceType.HORSE,
    RY: PieceType.DRAGON
};
function parsePosition(line, position) {
    position.resetBySFEN(InitialPositionSFEN.STANDARD);
    for(let i = 2; i + 4 <= line.length; i += 4){
        const file = Number(line[i]);
        const rank = Number(line[i + 1]);
        position.board.remove(new Square(file, rank));
    }
}
function parseRank(line, position) {
    const rank = Number(line[1]);
    let begin = 2;
    for(let x = 0; x < 9; x += 1){
        const file = 9 - x;
        const section = line.slice(begin, begin + 3);
        begin += 3;
        if (line[begin] === "*") {
            begin -= 1;
        }
        if (section[0] === " ") {
            continue;
        }
        const color = section[0] === "+" ? Color.BLACK : Color.WHITE;
        const pieceType = csaNameToPieceType[section.slice(1)];
        if (!pieceType) {
            return new InvalidPieceNameError(section);
        }
        position.board.set(new Square(file, rank), new Piece(color, pieceType));
    }
}
function parsePieces(line, position) {
    const color = line[1] === "+" ? Color.BLACK : Color.WHITE;
    for(let begin = 2; begin + 4 <= line.length; begin += 4){
        const section = line.slice(begin, begin + 4);
        if (section === "00AL") {
            const counts = countNotExistingPieces(position);
            if (color === Color.BLACK) {
                position.blackHand.forEach((pieceType)=>{
                    position.blackHand.add(pieceType, counts[pieceType]);
                });
            } else {
                position.whiteHand.forEach((pieceType)=>{
                    position.whiteHand.add(pieceType, counts[pieceType]);
                });
            }
            return;
        }
        const file = Number(section[0]);
        const rank = Number(section[1]);
        const pieceType = csaNameToPieceType[section.slice(2)];
        if (!pieceType) {
            return new InvalidPieceNameError(section);
        }
        if (file !== 0 && rank !== 0) {
            position.board.set(new Square(file, rank), new Piece(color, pieceType));
        } else if (color === Color.BLACK) {
            position.blackHand.add(pieceType, 1);
        } else {
            position.whiteHand.add(pieceType, 1);
        }
    }
}
function parseMove(line, position) {
    const color = line[0] === "+" ? Color.BLACK : Color.WHITE;
    if (color != position.color) {
        return new InvalidTurnError(line);
    }
    const fromFile = Number(line[1]);
    const fromRank = Number(line[2]);
    const toFile = Number(line[3]);
    const toRank = Number(line[4]);
    const pieceType = csaNameToPieceType[line.slice(5, 7)];
    if (!pieceType) {
        return new InvalidPieceNameError(line);
    }
    const from = fromFile === 0 && fromRank === 0 ? pieceType : new Square(fromFile, fromRank);
    const to = new Square(toFile, toRank);
    let move = position.createMove(from, to);
    if (!move) {
        return new InvalidMoveError(line);
    }
    if (from instanceof Square) {
        const basePiece = position.board.at(from);
        if (!basePiece) {
            return new PieceNotExistsError(line);
        }
        if (basePiece.type !== pieceType) {
            if (basePiece.promoted().type === pieceType) {
                move = move.withPromote();
            } else {
                return new PieceNotExistsError(line);
            }
        }
    }
    return move;
}
export function getSpecialMoveByName(name, color) {
    switch(name){
        case "CHUDAN":
            return specialMove(SpecialMoveType.INTERRUPT);
        case "TORYO":
            return specialMove(SpecialMoveType.RESIGN);
        case "MAX_MOVES":
            return specialMove(SpecialMoveType.MAX_MOVES);
        case "JISHOGI":
            return specialMove(SpecialMoveType.IMPASS);
        case "HIKIWAKE":
            return specialMove(SpecialMoveType.DRAW);
        case "SENNICHITE":
            return specialMove(SpecialMoveType.REPETITION_DRAW);
        case "TSUMI":
            return specialMove(SpecialMoveType.MATE);
        case "FUZUMI":
            return specialMove(SpecialMoveType.NO_MATE);
        case "TIME_UP":
            return specialMove(SpecialMoveType.TIMEOUT);
        case "ILLEGAL_MOVE":
            return specialMove(SpecialMoveType.FOUL_LOSE);
        case "+ILLEGAL_ACTION":
            return specialMove(color == Color.BLACK ? SpecialMoveType.FOUL_LOSE : SpecialMoveType.FOUL_WIN);
        case "-ILLEGAL_ACTION":
            return specialMove(color == Color.WHITE ? SpecialMoveType.FOUL_LOSE : SpecialMoveType.FOUL_WIN);
        case "KACHI":
            return specialMove(SpecialMoveType.ENTERING_OF_KING);
    }
    return anySpecialMove(name);
}
export function parseCSAMove(position, line) {
    return parseMove(line, position);
}
export function importCSA(data) {
    const metadata = new RecordMetadata();
    const record = new Record();
    const position = new Position();
    position.resetBySFEN(InitialPositionSFEN.EMPTY);
    let preMoveComment = "";
    let inMoveSection = false;
    const lines = data.replace(/\r?\n\/(\r?\n[\s\S]*)?$/, "").split(/\r?\n/);
    for (const line of lines){
        for (const parsed of parseLine(line)){
            if (parsed.sectionType === 1 && !inMoveSection) {
                return new InvalidLineError(parsed.line);
            }
            if (parsed.sectionType === 0 && inMoveSection) {
                continue;
            }
            switch(parsed.type){
                case 0:
                    break;
                case 1:
                    if (inMoveSection) {
                        record.current.comment = appendLine(record.current.comment, parsed.args[0]);
                    } else {
                        preMoveComment = appendLine(preMoveComment, parsed.args[0]);
                    }
                    break;
                case 2:
                    break;
                case 3:
                    metadata.setStandardMetadata(RecordMetadataKey.BLACK_NAME, parsed.args[0]);
                    break;
                case 4:
                    metadata.setStandardMetadata(RecordMetadataKey.WHITE_NAME, parsed.args[0]);
                    break;
                case 5:
                    {
                        const key = csaNameToRecordMetadataKey[parsed.args[0]];
                        if (key) {
                            metadata.setStandardMetadata(key, parsed.args[1]);
                        } else {
                            metadata.setCustomMetadata(parsed.args[0], parsed.args[1]);
                        }
                        break;
                    }
                case 6:
                    parsePosition(parsed.line, position);
                    break;
                case 7:
                    {
                        const error = parseRank(parsed.line, position);
                        if (error) {
                            return error;
                        }
                        break;
                    }
                case 8:
                    {
                        const error = parsePieces(parsed.line, position);
                        if (error) {
                            return error;
                        }
                        break;
                    }
                case 9:
                    if (parsed.line[0] === "+") {
                        position.setColor(Color.BLACK);
                    } else {
                        position.setColor(Color.WHITE);
                    }
                    record.clear(position);
                    record.first.comment = preMoveComment;
                    inMoveSection = true;
                    break;
                case 10:
                    {
                        const moveOrError = parseMove(parsed.line, record.position);
                        if (moveOrError instanceof Error) {
                            return moveOrError;
                        }
                        record.append(moveOrError, {
                            ignoreValidation: true
                        });
                        break;
                    }
                case 11:
                    {
                        const specialMove = getSpecialMoveByName(parsed.line.slice(1), record.position.color);
                        record.append(specialMove, {
                            ignoreValidation: true
                        });
                        break;
                    }
                case 12:
                    record.current.setElapsedMs(Number(parsed.args[0]) * 1e3);
                    break;
            }
        }
    }
    if (!inMoveSection) {
        record.clear(position);
        record.first.comment = preMoveComment;
    }
    record.goto(0);
    record.resetAllBranchSelection();
    record.metadata = metadata;
    return record;
}
const timeRegExpV2 = /^[0-9]+:[0-9]{2}\+[0-9]+$/;
const timeRegExpV3 = /^[0-9.]+\+[0-9.]+\+[0-9.]+$/;
function formatMetadata(metadata, options) {
    let ret = "";
    const returnCode = options?.returnCode || "\n";
    const blackName = getBlackPlayerName(metadata);
    if (blackName) {
        ret += "N+" + blackName + returnCode;
    }
    const whiteName = getWhitePlayerName(metadata);
    if (whiteName) {
        ret += "N-" + whiteName + returnCode;
    }
    const event = metadata.getStandardMetadata(RecordMetadataKey.TOURNAMENT) || metadata.getStandardMetadata(RecordMetadataKey.TITLE) || metadata.getStandardMetadata(RecordMetadataKey.OPUS_NAME) || metadata.getStandardMetadata(RecordMetadataKey.PUBLISHED_BY);
    if (event) {
        ret += "$EVENT:" + event + returnCode;
    }
    const site = metadata.getStandardMetadata(RecordMetadataKey.PLACE);
    if (site) {
        ret += "$SITE:" + site + returnCode;
    }
    const startTime = metadata.getStandardMetadata(RecordMetadataKey.START_DATETIME) || metadata.getStandardMetadata(RecordMetadataKey.DATE);
    if (startTime) {
        ret += "$START_TIME:" + startTime.slice(10) + returnCode;
    }
    const endTime = metadata.getStandardMetadata(RecordMetadataKey.DATE);
    if (endTime) {
        ret += "$END_TIME:" + endTime.slice(10) + returnCode;
    }
    const opening = metadata.getStandardMetadata(RecordMetadataKey.STRATEGY);
    if (opening) {
        ret += "$OPENING:" + opening + returnCode;
    }
    const timeLimit = metadata.getStandardMetadata(RecordMetadataKey.TIME_LIMIT);
    if (timeLimit && timeRegExpV2.test(timeLimit)) {
        ret += "$TIME_LIMIT:" + timeLimit + returnCode;
    } else if (timeLimit && timeRegExpV3.test(timeLimit)) {
        ret += "$TIME:" + timeLimit + returnCode;
    }
    const blackTimeLimit = metadata.getStandardMetadata(RecordMetadataKey.BLACK_TIME_LIMIT);
    if (blackTimeLimit && timeRegExpV3.test(blackTimeLimit)) {
        ret += "$TIME+:" + blackTimeLimit + returnCode;
    }
    const whiteTimeLimit = metadata.getStandardMetadata(RecordMetadataKey.WHITE_TIME_LIMIT);
    if (whiteTimeLimit && timeRegExpV3.test(whiteTimeLimit)) {
        ret += "$TIME-:" + whiteTimeLimit + returnCode;
    }
    const maxMoves = metadata.getStandardMetadata(RecordMetadataKey.MAX_MOVES);
    if (maxMoves) {
        ret += "$MAX_MOVES:" + maxMoves + returnCode;
    }
    const jishogi = metadata.getStandardMetadata(RecordMetadataKey.JISHOGI);
    if (jishogi) {
        ret += "$JISHOGI:" + jishogi + returnCode;
    }
    const note = metadata.getStandardMetadata(RecordMetadataKey.NOTE);
    if (note) {
        ret += "$NOTE:" + note + returnCode;
    }
    return ret;
}
const pieceTypeToString = {
    king: "OU",
    rook: "HI",
    dragon: "RY",
    bishop: "KA",
    horse: "UM",
    gold: "KI",
    silver: "GI",
    promSilver: "NG",
    knight: "KE",
    promKnight: "NK",
    lance: "KY",
    promLance: "NY",
    pawn: "FU",
    promPawn: "TO"
};
function formatHand(hand) {
    let ret = "";
    hand.forEach((pieceType, n)=>{
        for(let i = 0; i < n; i++){
            ret += "00" + pieceTypeToString[pieceType];
        }
    });
    return ret;
}
const sfenToPCommand = {
    [InitialPositionSFEN.STANDARD]: [
        "PI",
        "+"
    ],
    [InitialPositionSFEN.HANDICAP_LANCE]: [
        "PI11KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_RIGHT_LANCE]: [
        "PI91KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_BISHOP]: [
        "PI22KA",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_ROOK]: [
        "PI82HI",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_ROOK_LANCE]: [
        "PI82HI11KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_2PIECES]: [
        "PI82HI22KA",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_4PIECES]: [
        "PI82HI22KA11KY91KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_6PIECES]: [
        "PI82HI22KA21KE81KE11KY91KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_8PIECES]: [
        "PI82HI22KA31GI71GI21KE81KE11KY91KY",
        "-"
    ],
    [InitialPositionSFEN.HANDICAP_10PIECES]: [
        "PI82HI22KA41KI61KI31GI71GI21KE81KE11KY91KY",
        "-"
    ]
};
function formatPosition(position, options) {
    const returnCode = options?.returnCode || "\n";
    const p = sfenToPCommand[position.sfen];
    if (p) {
        return p[0] + returnCode + p[1] + returnCode;
    }
    let ret = "";
    for(let rank = 1; rank <= 9; rank += 1){
        ret += "P" + rank;
        for(let file = 9; file >= 1; file -= 1){
            const piece = position.board.at(new Square(file, rank));
            if (!piece) {
                ret += " * ";
            } else if (piece.color === Color.BLACK) {
                ret += "+" + pieceTypeToString[piece.type];
            } else {
                ret += "-" + pieceTypeToString[piece.type];
            }
        }
        ret += returnCode;
    }
    ret += "P+" + formatHand(position.blackHand) + returnCode;
    ret += "P-" + formatHand(position.whiteHand) + returnCode;
    ret += (position.color === Color.BLACK ? "+" : "-") + returnCode;
    return ret;
}
function formatSquare(square) {
    return square instanceof Square ? `${square.file}${square.rank}` : "00";
}
export function getCSASpecialMoveName(move, color) {
    switch(move.type){
        case SpecialMoveType.INTERRUPT:
            return "CHUDAN";
        case SpecialMoveType.RESIGN:
            return "TORYO";
        case SpecialMoveType.MAX_MOVES:
            return "MAX_MOVES";
        case SpecialMoveType.IMPASS:
            return "JISHOGI";
        case SpecialMoveType.DRAW:
            return "HIKIWAKE";
        case SpecialMoveType.REPETITION_DRAW:
            return "SENNICHITE";
        case SpecialMoveType.MATE:
            return "TSUMI";
        case SpecialMoveType.NO_MATE:
            return "FUZUMI";
        case SpecialMoveType.TIMEOUT:
            return "TIME_UP";
        case SpecialMoveType.FOUL_LOSE:
            return "ILLEGAL_MOVE";
        case SpecialMoveType.FOUL_WIN:
            return color == Color.BLACK ? "-ILLEGAL_ACTION" : "+ILLEGAL_ACTION";
        case SpecialMoveType.ENTERING_OF_KING:
            return "KACHI";
    }
}
export function formatCSAMove(move) {
    return (move.color === Color.BLACK ? "+" : "-") + formatSquare(move.from) + formatSquare(move.to) + pieceTypeToString[move.promote ? promotedPieceType(move.pieceType) : move.pieceType];
}
export function exportCSA(record, options) {
    const returnCode = options?.returnCode || "\n";
    let ret = "";
    if (options?.v3) {
        ret += "'CSA encoding=" + (options.v3.encoding || "UTF-8") + returnCode;
    }
    if (options?.comment) {
        for (const line of options.comment.split("\n")){
            ret += "'" + line + returnCode;
        }
    }
    ret += (options?.v3 ? "V3.0" : "V2.2") + returnCode;
    ret += formatMetadata(record.metadata, options);
    ret += formatPosition(record.initialPosition, options);
    record.moves.forEach((node)=>{
        if (node.ply !== 0) {
            let move;
            if (node.move instanceof Move) {
                move = formatCSAMove(node.move);
            } else {
                const name = getCSASpecialMoveName(node.move, node.nextColor);
                if (name) {
                    move = "%" + name;
                }
            }
            if (move) {
                ret += move + returnCode;
                if (options?.v3?.milliseconds && node.elapsedMs % 1e3 !== 0) {
                    ret += "T" + node.elapsedMs / 1e3 + returnCode;
                } else {
                    ret += "T" + Math.floor(node.elapsedMs / 1e3) + returnCode;
                }
            }
        }
        if (node.comment) {
            const comment = node.comment.endsWith("\n") ? node.comment.slice(0, -1) : node.comment;
            comment.split("\n").forEach((line)=>{
                ret += "'*" + line + returnCode;
            });
        }
    });
    return ret;
}
