import { Color, reverseColor } from "./color.js";
export var PieceType = /*#__PURE__*/ function(PieceType) {
    PieceType["PAWN"] = "pawn";
    PieceType["LANCE"] = "lance";
    PieceType["KNIGHT"] = "knight";
    PieceType["SILVER"] = "silver";
    PieceType["GOLD"] = "gold";
    PieceType["BISHOP"] = "bishop";
    PieceType["ROOK"] = "rook";
    PieceType["KING"] = "king";
    PieceType["PROM_PAWN"] = "promPawn";
    PieceType["PROM_LANCE"] = "promLance";
    PieceType["PROM_KNIGHT"] = "promKnight";
    PieceType["PROM_SILVER"] = "promSilver";
    PieceType["HORSE"] = "horse";
    PieceType["DRAGON"] = "dragon";
    return PieceType;
}({});
const standardPieceNameMap = {
    pawn: "歩",
    lance: "香",
    knight: "桂",
    silver: "銀",
    gold: "金",
    bishop: "角",
    rook: "飛",
    king: "玉",
    promPawn: "と",
    promLance: "成香",
    promKnight: "成桂",
    promSilver: "成銀",
    horse: "馬",
    dragon: "竜"
};
export function standardPieceName(type) {
    const val = standardPieceNameMap[type];
    return val || "";
}
export const pieceTypes = [
    "pawn",
    "lance",
    "knight",
    "silver",
    "gold",
    "bishop",
    "rook",
    "king",
    "promPawn",
    "promLance",
    "promKnight",
    "promSilver",
    "horse",
    "dragon"
];
export const handPieceTypes = [
    "pawn",
    "lance",
    "knight",
    "silver",
    "gold",
    "bishop",
    "rook"
];
const promotable = {
    pawn: true,
    lance: true,
    knight: true,
    silver: true,
    gold: false,
    bishop: true,
    rook: true,
    king: false,
    promPawn: false,
    promLance: false,
    promKnight: false,
    promSilver: false,
    horse: false,
    dragon: false
};
export function isPromotable(pieceType) {
    return !!promotable[pieceType];
}
const promoteMap = {
    pawn: "promPawn",
    lance: "promLance",
    knight: "promKnight",
    silver: "promSilver",
    bishop: "horse",
    rook: "dragon"
};
export function promotedPieceType(pieceType) {
    return promoteMap[pieceType] || pieceType;
}
const unpromoteMap = {
    promPawn: "pawn",
    promLance: "lance",
    promKnight: "knight",
    promSilver: "silver",
    horse: "bishop",
    dragon: "rook"
};
export function unpromotedPieceType(pieceType) {
    return unpromoteMap[pieceType] || pieceType;
}
const toSFENCharBlack = {
    pawn: "P",
    lance: "L",
    knight: "N",
    silver: "S",
    gold: "G",
    bishop: "B",
    rook: "R",
    king: "K",
    promPawn: "+P",
    promLance: "+L",
    promKnight: "+N",
    promSilver: "+S",
    horse: "+B",
    dragon: "+R"
};
export function pieceTypeToSFEN(type) {
    return toSFENCharBlack[type];
}
const toSFENCharWhite = {
    pawn: "p",
    lance: "l",
    knight: "n",
    silver: "s",
    gold: "g",
    bishop: "b",
    rook: "r",
    king: "k",
    promPawn: "+p",
    promLance: "+l",
    promKnight: "+n",
    promSilver: "+s",
    horse: "+b",
    dragon: "+r"
};
const sfenCharToTypeMap = {
    P: "pawn",
    L: "lance",
    N: "knight",
    S: "silver",
    G: "gold",
    B: "bishop",
    R: "rook",
    K: "king",
    "+P": "promPawn",
    "+L": "promLance",
    "+N": "promKnight",
    "+S": "promSilver",
    "+B": "horse",
    "+R": "dragon",
    p: "pawn",
    l: "lance",
    n: "knight",
    s: "silver",
    g: "gold",
    b: "bishop",
    r: "rook",
    k: "king",
    "+p": "promPawn",
    "+l": "promLance",
    "+n": "promKnight",
    "+s": "promSilver",
    "+b": "horse",
    "+r": "dragon"
};
const sfenCharToColorMap = {
    P: Color.BLACK,
    L: Color.BLACK,
    N: Color.BLACK,
    S: Color.BLACK,
    G: Color.BLACK,
    B: Color.BLACK,
    R: Color.BLACK,
    K: Color.BLACK,
    "+P": Color.BLACK,
    "+L": Color.BLACK,
    "+N": Color.BLACK,
    "+S": Color.BLACK,
    "+B": Color.BLACK,
    "+R": Color.BLACK,
    p: Color.WHITE,
    l: Color.WHITE,
    n: Color.WHITE,
    s: Color.WHITE,
    g: Color.WHITE,
    b: Color.WHITE,
    r: Color.WHITE,
    k: Color.WHITE,
    "+p": Color.WHITE,
    "+l": Color.WHITE,
    "+n": Color.WHITE,
    "+s": Color.WHITE,
    "+b": Color.WHITE,
    "+r": Color.WHITE
};
const rotateMap = new Map();
rotateMap.set("pawn", {
    type: "promPawn",
    reverseColor: false
});
rotateMap.set("lance", {
    type: "promLance",
    reverseColor: false
});
rotateMap.set("knight", {
    type: "promKnight",
    reverseColor: false
});
rotateMap.set("silver", {
    type: "promSilver",
    reverseColor: false
});
rotateMap.set("gold", {
    type: "gold",
    reverseColor: true
});
rotateMap.set("bishop", {
    type: "horse",
    reverseColor: false
});
rotateMap.set("rook", {
    type: "dragon",
    reverseColor: false
});
rotateMap.set("king", {
    type: "king",
    reverseColor: true
});
rotateMap.set("promPawn", {
    type: "pawn",
    reverseColor: true
});
rotateMap.set("promLance", {
    type: "lance",
    reverseColor: true
});
rotateMap.set("promKnight", {
    type: "knight",
    reverseColor: true
});
rotateMap.set("promSilver", {
    type: "silver",
    reverseColor: true
});
rotateMap.set("horse", {
    type: "bishop",
    reverseColor: true
});
rotateMap.set("dragon", {
    type: "rook",
    reverseColor: true
});
export class Piece {
    color;
    type;
    constructor(color, type){
        this.color = color;
        this.type = type;
    }
    black() {
        return this.withColor(Color.BLACK);
    }
    white() {
        return this.withColor(Color.WHITE);
    }
    withColor(color) {
        return new Piece(color, this.type);
    }
    equals(piece) {
        return this.type === piece.type && this.color === piece.color;
    }
    promoted() {
        const type = promoteMap[this.type];
        return new Piece(this.color, type || this.type);
    }
    unpromoted() {
        const type = unpromoteMap[this.type];
        return new Piece(this.color, type || this.type);
    }
    isPromotable() {
        return isPromotable(this.type);
    }
    rotate() {
        const r = rotateMap.get(this.type);
        const piece = new Piece(this.color, r ? r.type : this.type);
        if (r && r.reverseColor) {
            piece.color = reverseColor(this.color);
        }
        return piece;
    }
    get id() {
        return this.color + "_" + this.type;
    }
    get sfen() {
        switch(this.color){
            default:
            case Color.BLACK:
                return toSFENCharBlack[this.type];
            case Color.WHITE:
                return toSFENCharWhite[this.type];
        }
    }
    static isValidSFEN(sfen) {
        return !!sfenCharToTypeMap[sfen];
    }
    static newBySFEN(sfen) {
        const type = sfenCharToTypeMap[sfen];
        if (!type) {
            return null;
        }
        const color = sfenCharToColorMap[sfen];
        if (!color) {
            return null;
        }
        return new Piece(color, type);
    }
}
