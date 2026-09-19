import { Color } from "./color.js";
import { Piece, PieceType, pieceTypeToSFEN } from "./piece.js";
import { Square } from "./square.js";
export class Move {
    from;
    to;
    promote;
    color;
    pieceType;
    capturedPieceType;
    constructor(from, to, promote, color, pieceType, capturedPieceType){
        this.from = from;
        this.to = to;
        this.promote = promote;
        this.color = color;
        this.pieceType = pieceType;
        this.capturedPieceType = capturedPieceType;
    }
    equals(move) {
        if (!move) {
            return false;
        }
        return (this.from instanceof Square && move.from instanceof Square && this.from.equals(move.from) || !(this.from instanceof Square) && !(move.from instanceof Square) && this.from === move.from) && this.to.equals(move.to) && this.promote === move.promote && this.color === move.color && this.pieceType === move.pieceType && this.capturedPieceType === move.capturedPieceType;
    }
    withPromote() {
        return new Move(this.from, this.to, true, this.color, this.pieceType, this.capturedPieceType);
    }
    get usi() {
        let ret = "";
        if (this.from instanceof Square) {
            ret += this.from.usi;
        } else {
            ret += pieceTypeToSFEN(this.from) + "*";
        }
        ret += this.to.usi;
        if (this.promote) {
            ret += "+";
        }
        return ret;
    }
}
export function parseUSIMove(usiMove) {
    let from;
    if (usiMove[1] === "*") {
        const piece = Piece.newBySFEN(usiMove[0]);
        if (!piece) {
            return null;
        }
        from = piece.type;
    } else {
        const square = Square.newByUSI(usiMove);
        if (!square) {
            return null;
        }
        from = square;
    }
    const to = Square.newByUSI(usiMove.substring(2));
    if (!to) {
        return null;
    }
    const promote = usiMove.length >= 5 && usiMove[4] === "+";
    return {
        from,
        to,
        promote
    };
}
export var SpecialMoveType = /*#__PURE__*/ function(SpecialMoveType) {
    SpecialMoveType["START"] = "start";
    SpecialMoveType["INTERRUPT"] = "interrupt";
    SpecialMoveType["RESIGN"] = "resign";
    SpecialMoveType["MAX_MOVES"] = "maxMoves";
    SpecialMoveType["IMPASS"] = "impass";
    SpecialMoveType["DRAW"] = "draw";
    SpecialMoveType["REPETITION_DRAW"] = "repetitionDraw";
    SpecialMoveType["MATE"] = "mate";
    SpecialMoveType["NO_MATE"] = "noMate";
    SpecialMoveType["TIMEOUT"] = "timeout";
    SpecialMoveType["FOUL_WIN"] = "foulWin";
    SpecialMoveType["FOUL_LOSE"] = "foulLose";
    SpecialMoveType["ENTERING_OF_KING"] = "enteringOfKing";
    SpecialMoveType["WIN_BY_DEFAULT"] = "winByDefault";
    SpecialMoveType["LOSE_BY_DEFAULT"] = "loseByDefault";
    SpecialMoveType["TRY"] = "try";
    return SpecialMoveType;
}({});
export function specialMove(type) {
    return {
        type
    };
}
export function anySpecialMove(name) {
    return {
        type: "any",
        name
    };
}
export function isKnownSpecialMove(move) {
    return !(move instanceof Move) && move.type !== "any";
}
export function areSameSpecialMoves(a, b) {
    if (a.type === "any" && b.type === "any") {
        return a.name === b.name;
    }
    return a.type === b.type;
}
export function areSameMoves(a, b) {
    if (a instanceof Move && b instanceof Move) {
        return a.equals(b);
    }
    if (a instanceof Move || b instanceof Move) {
        return false;
    }
    return areSameSpecialMoves(a, b);
}
