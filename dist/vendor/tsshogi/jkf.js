import { Color } from "./color.js";
import { getSpecialMoveByName, getCSASpecialMoveName } from "./csa.js";
import { kakinokiToMetadataKey, metadataKeyToKakinoki } from "./kakinoki.js";
import { Move } from "./move.js";
import { Piece, PieceType, isPromotable } from "./piece.js";
import { InitialPositionSFEN, Position, isPromotableRank } from "./position.js";
import { Record } from "./record.js";
import { Square } from "./square.js";
import { getDirectionModifier } from "./text.js";
export var JKFColor = /*#__PURE__*/ function(JKFColor) {
    JKFColor[JKFColor["BLACK"] = 0] = "BLACK";
    JKFColor[JKFColor["WHITE"] = 1] = "WHITE";
    return JKFColor;
}({});
export var JKFSpecial = /*#__PURE__*/ function(JKFSpecial) {
    JKFSpecial["TORYO"] = "TORYO";
    JKFSpecial["CHUDAN"] = "CHUDAN";
    JKFSpecial["SENNICHITE"] = "SENNICHITE";
    JKFSpecial["TIME_UP"] = "TIME_UP";
    JKFSpecial["ILLEGAL_MOVE"] = "ILLEGAL_MOVE";
    JKFSpecial["BLACK_ILLEGAL_ACTION"] = "+ILLEGAL_ACTION";
    JKFSpecial["WHITE_ILLEGAL_ACTION"] = "-ILLEGAL_ACTION";
    JKFSpecial["JISHOGI"] = "JISHOGI";
    JKFSpecial["KACHI"] = "KACHI";
    JKFSpecial["HIKIWAKE"] = "HIKIWAKE";
    JKFSpecial["MAX_MOVES"] = "MAX_MOVES";
    JKFSpecial["MATTA"] = "MATTA";
    JKFSpecial["TSUMI"] = "TSUMI";
    JKFSpecial["FUZUMI"] = "FUZUMI";
    JKFSpecial["ERROR"] = "ERROR";
    return JKFSpecial;
}({});
export var JKFKind = /*#__PURE__*/ function(JKFKind) {
    JKFKind["FU"] = "FU";
    JKFKind["KY"] = "KY";
    JKFKind["KE"] = "KE";
    JKFKind["GI"] = "GI";
    JKFKind["KI"] = "KI";
    JKFKind["KA"] = "KA";
    JKFKind["HI"] = "HI";
    JKFKind["OU"] = "OU";
    JKFKind["TO"] = "TO";
    JKFKind["NY"] = "NY";
    JKFKind["NK"] = "NK";
    JKFKind["NG"] = "NG";
    JKFKind["UM"] = "UM";
    JKFKind["RY"] = "RY";
    return JKFKind;
}({});
function msToJKFTimeMS(ms) {
    return {
        m: Math.floor(ms / (60 * 1000)),
        s: Math.floor(ms / 1000) % 60
    };
}
function msToJKFTimeHMS(ms) {
    return {
        h: Math.floor(ms / (60 * 60 * 1000)),
        m: Math.floor(ms / (60 * 1000)) % 60,
        s: Math.floor(ms / 1000) % 60
    };
}
function jkfTimeToMs(time) {
    return ((time.h || 0) * 60 * 60 + time.m * 60 + time.s) * 1000;
}
function colorToJKF(color) {
    switch(color){
        case Color.BLACK:
            return 0;
        default:
            return 1;
    }
}
function jkfToColor(color) {
    switch(color){
        default:
            return Color.BLACK;
        case 1:
            return Color.WHITE;
    }
}
function pieceTypeToJKF(type) {
    switch(type){
        case PieceType.PAWN:
            return "FU";
        case PieceType.LANCE:
            return "KY";
        case PieceType.KNIGHT:
            return "KE";
        case PieceType.SILVER:
            return "GI";
        case PieceType.GOLD:
            return "KI";
        case PieceType.BISHOP:
            return "KA";
        case PieceType.ROOK:
            return "HI";
        case PieceType.KING:
            return "OU";
        case PieceType.PROM_PAWN:
            return "TO";
        case PieceType.PROM_LANCE:
            return "NY";
        case PieceType.PROM_KNIGHT:
            return "NK";
        case PieceType.PROM_SILVER:
            return "NG";
        case PieceType.HORSE:
            return "UM";
        case PieceType.DRAGON:
            return "RY";
    }
}
function jkfToPieceType(kind) {
    switch(kind){
        case "FU":
            return PieceType.PAWN;
        case "KY":
            return PieceType.LANCE;
        case "KE":
            return PieceType.KNIGHT;
        case "GI":
            return PieceType.SILVER;
        case "KI":
            return PieceType.GOLD;
        case "KA":
            return PieceType.BISHOP;
        case "HI":
            return PieceType.ROOK;
        case "OU":
            return PieceType.KING;
        case "TO":
            return PieceType.PROM_PAWN;
        case "NY":
            return PieceType.PROM_LANCE;
        case "NK":
            return PieceType.PROM_KNIGHT;
        case "NG":
            return PieceType.PROM_SILVER;
        case "UM":
            return PieceType.HORSE;
        case "RY":
            return PieceType.DRAGON;
    }
}
const directionModifierToJKF = {
    左: "L",
    直: "C",
    右: "R",
    上: "U",
    寄: "M",
    引: "D",
    打: "H"
};
export function importJKFString(data) {
    try {
        return importJKF(JSON.parse(data));
    } catch (e) {
        return new Error("failed to parse JSON: " + e);
    }
}
export function importJKF(jkf) {
    try {
        const position = new Position();
        if (jkf.initial) {
            switch(jkf.initial.preset){
                case "HIRATE":
                    position.resetBySFEN(InitialPositionSFEN.STANDARD);
                    break;
                case "KY":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_LANCE);
                    break;
                case "KY_R":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_RIGHT_LANCE);
                    break;
                case "KA":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_BISHOP);
                    break;
                case "HI":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_ROOK);
                    break;
                case "HIKY":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_ROOK_LANCE);
                    break;
                case "2":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_2PIECES);
                    break;
                case "4":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_4PIECES);
                    break;
                case "6":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_6PIECES);
                    break;
                case "8":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_8PIECES);
                    break;
                case "10":
                    position.resetBySFEN(InitialPositionSFEN.HANDICAP_10PIECES);
                    break;
                case "OTHER":
                    position.resetBySFEN(InitialPositionSFEN.EMPTY);
                    if (jkf.initial.data) {
                        position.setColor(jkfToColor(jkf.initial.data.color));
                        if (Array.isArray(jkf.initial.data.board)) {
                            for(let x = 1; x <= 9; x++){
                                for(let y = 1; y <= 9; y++){
                                    const piece = jkf.initial.data.board[x - 1][y - 1];
                                    if (piece?.kind) {
                                        const square = new Square(x, y);
                                        const color = jkfToColor(piece.color);
                                        const pieceType = jkfToPieceType(piece.kind);
                                        position.board.set(square, new Piece(color, pieceType));
                                    }
                                }
                            }
                        }
                        for (const kind of Object.values(JKFKind)){
                            const b = jkf.initial.data.hands[0][kind] || 0;
                            position.blackHand.set(jkfToPieceType(kind), b);
                            const w = jkf.initial.data.hands[1][kind] || 0;
                            position.whiteHand.set(jkfToPieceType(kind), w);
                        }
                    }
                    break;
                default:
                    return new Error("initial position preset not supported: " + jkf.initial.preset);
            }
        }
        const record = new Record(position);
        Object.entries(jkf.header).forEach(([key, value])=>{
            const metadataKey = kakinokiToMetadataKey(key);
            if (metadataKey) {
                record.metadata.setStandardMetadata(metadataKey, value);
            } else {
                record.metadata.setCustomMetadata(key, value);
            }
        });
        const stack = [
            {
                ply: 0,
                moves: jkf.moves
            }
        ];
        while(stack.length > 0){
            const entry = stack.pop();
            record.goto(entry.ply);
            for (const m of entry.moves){
                const ply = record.current.ply;
                if (m.move) {
                    let from;
                    if (m.move.from) {
                        from = new Square(m.move.from.x, m.move.from.y);
                    } else if (m.move.relative && m.move.relative !== "H") {
                        return new Error("unnormalized-JKF not supported.");
                    } else {
                        from = jkfToPieceType(m.move.piece);
                    }
                    let to;
                    if (m.move.to) {
                        to = new Square(m.move.to.x, m.move.to.y);
                    } else if (m.move.same && record.current.prev?.move instanceof Move) {
                        to = record.current.prev.move.to;
                    } else {
                        return new Error("invalid move: " + JSON.stringify(m.move));
                    }
                    let move = record.position.createMove(from, to);
                    if (!move) {
                        return new Error("invalid move: " + JSON.stringify(m.move));
                    }
                    if (m.move.promote) {
                        move = move.withPromote();
                    }
                    record.append(move, {
                        ignoreValidation: true
                    });
                }
                if (m.special) {
                    const move = getSpecialMoveByName(m.special, record.current.nextColor);
                    if (move) {
                        record.append(move);
                    }
                }
                if (m.time) {
                    record.current.setElapsedMs(jkfTimeToMs(m.time.now));
                }
                if (m.comments) {
                    record.current.comment = m.comments.join("\n");
                }
                if (m.forks) {
                    for(let i = m.forks.length - 1; i >= 0; i--){
                        stack.push({
                            ply: ply,
                            moves: m.forks[i]
                        });
                    }
                }
            }
        }
        record.goto(0);
        record.resetAllBranchSelection();
        return record;
    } catch (e) {
        return new Error("failed to  JKF: " + e);
    }
}
function buildJKFMoves(node, basePos) {
    const position = basePos.clone();
    const moves = [];
    for(; node; node = node.next){
        const entry = {
            time: {
                now: msToJKFTimeMS(node.elapsedMs),
                total: msToJKFTimeHMS(node.totalElapsedMs)
            }
        };
        if (node.move instanceof Move) {
            const move = node.move;
            entry.move = {
                color: colorToJKF(move.color),
                piece: pieceTypeToJKF(move.pieceType),
                to: {
                    x: move.to.file,
                    y: move.to.rank
                }
            };
            if (move.from instanceof Square) {
                entry.move.from = {
                    x: move.from.file,
                    y: move.from.rank
                };
                if (node.prev?.move instanceof Move && node.prev.move.to === move.to) {
                    entry.move.same = true;
                }
                if (move.promote) {
                    entry.move.promote = true;
                } else if (isPromotable(move.pieceType) && (isPromotableRank(move.color, move.from.rank) || isPromotableRank(move.color, move.to.rank))) {
                    entry.move.promote = false;
                }
                if (move.capturedPieceType) {
                    entry.move.capture = pieceTypeToJKF(move.capturedPieceType);
                }
            }
            const relative = getDirectionModifier(move, position).split("").map((s)=>{
                return directionModifierToJKF[s] || "";
            }).join("");
            if (relative) {
                entry.move.relative = relative;
            }
        } else {
            const command = getCSASpecialMoveName(node.move, node.nextColor);
            if (!command) {
                break;
            }
            entry.special = command;
        }
        if (node.comment) {
            entry.comments = node.comment.trimEnd().split("\n");
        }
        if (node.isFirstBranch) {
            const forks = [];
            for(let branch = node.branch; branch; branch = branch.branch){
                forks.push(buildJKFMoves(branch, position));
            }
            if (forks.length !== 0) {
                entry.forks = forks;
            }
        }
        moves.push(entry);
        if (node.move instanceof Move) {
            if (!position.doMove(node.move, {
                ignoreValidation: true
            })) {
                break;
            }
        }
    }
    return moves;
}
export function exportJKFString(record) {
    return JSON.stringify(exportJKF(record));
}
export function exportJKF(record) {
    const header = {};
    for (const key of record.metadata.standardMetadataKeys){
        const value = record.metadata.getStandardMetadata(key);
        if (value) {
            header[metadataKeyToKakinoki(key)] = value;
        }
    }
    for (const key of record.metadata.customMetadataKeys){
        const value = record.metadata.getCustomMetadata(key);
        if (value) {
            header[key] = value;
        }
    }
    let initial;
    const blackHand = record.initialPosition.blackHand;
    const whiteHand = record.initialPosition.whiteHand;
    switch(record.initialPosition.sfen){
        case InitialPositionSFEN.STANDARD:
            initial = {
                preset: "HIRATE"
            };
            break;
        case InitialPositionSFEN.HANDICAP_LANCE:
            initial = {
                preset: "KY"
            };
            break;
        case InitialPositionSFEN.HANDICAP_RIGHT_LANCE:
            initial = {
                preset: "KY_R"
            };
            break;
        case InitialPositionSFEN.HANDICAP_BISHOP:
            initial = {
                preset: "KA"
            };
            break;
        case InitialPositionSFEN.HANDICAP_ROOK:
            initial = {
                preset: "HI"
            };
            break;
        case InitialPositionSFEN.HANDICAP_ROOK_LANCE:
            initial = {
                preset: "HIKY"
            };
            break;
        case InitialPositionSFEN.HANDICAP_2PIECES:
            initial = {
                preset: "2"
            };
            break;
        case InitialPositionSFEN.HANDICAP_4PIECES:
            initial = {
                preset: "4"
            };
            break;
        case InitialPositionSFEN.HANDICAP_6PIECES:
            initial = {
                preset: "6"
            };
            break;
        case InitialPositionSFEN.HANDICAP_8PIECES:
            initial = {
                preset: "8"
            };
            break;
        case InitialPositionSFEN.HANDICAP_10PIECES:
            initial = {
                preset: "10"
            };
            break;
        default:
            initial = {
                preset: "OTHER",
                data: {
                    color: colorToJKF(record.initialPosition.color),
                    board: function() {
                        const board = [
                            [],
                            [],
                            [],
                            [],
                            [],
                            [],
                            [],
                            [],
                            []
                        ];
                        for(let x = 1; x <= 9; x++){
                            for(let y = 1; y <= 9; y++){
                                const square = new Square(x, y);
                                const piece = record.initialPosition.board.at(square);
                                board[x - 1][y - 1] = piece ? {
                                    color: colorToJKF(piece.color),
                                    kind: pieceTypeToJKF(piece.type)
                                } : {};
                            }
                        }
                        return board;
                    }(),
                    hands: [
                        {
                            FU: blackHand.count(PieceType.PAWN),
                            KY: blackHand.count(PieceType.LANCE),
                            KE: blackHand.count(PieceType.KNIGHT),
                            GI: blackHand.count(PieceType.SILVER),
                            KI: blackHand.count(PieceType.GOLD),
                            KA: blackHand.count(PieceType.BISHOP),
                            HI: blackHand.count(PieceType.ROOK)
                        },
                        {
                            FU: whiteHand.count(PieceType.PAWN),
                            KY: whiteHand.count(PieceType.LANCE),
                            KE: whiteHand.count(PieceType.KNIGHT),
                            GI: whiteHand.count(PieceType.SILVER),
                            KI: whiteHand.count(PieceType.GOLD),
                            KA: whiteHand.count(PieceType.BISHOP),
                            HI: whiteHand.count(PieceType.ROOK)
                        }
                    ]
                }
            };
            break;
    }
    const moves = [
        record.first.comment ? {
            comments: record.first.comment.trimEnd().split("\n")
        } : {},
        ...record.first.next ? buildJKFMoves(record.first.next, record.initialPosition) : []
    ];
    return {
        header,
        initial,
        moves
    };
}
