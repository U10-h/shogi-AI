import { Board } from "./board.js";
import { Color, reverseColor, colorToSFEN, parseSFENColor, isValidSFENColor } from "./color.js";
import { Move, parseUSIMove } from "./move.js";
import { Square } from "./square.js";
import { Hand } from "./hand.js";
import { Piece, PieceType } from "./piece.js";
import { Direction, directionToDeltaMap, movableDirections, MoveType, resolveMoveType, vectorToDirectionAndDistance } from "./direction.js";
export var InitialPositionType = /*#__PURE__*/ function(InitialPositionType) {
    InitialPositionType["STANDARD"] = "standard";
    InitialPositionType["EMPTY"] = "empty";
    InitialPositionType["HANDICAP_LANCE"] = "handicapLance";
    InitialPositionType["HANDICAP_RIGHT_LANCE"] = "handicapRightLance";
    InitialPositionType["HANDICAP_BISHOP"] = "handicapBishop";
    InitialPositionType["HANDICAP_ROOK"] = "handicapRook";
    InitialPositionType["HANDICAP_ROOK_LANCE"] = "handicapRookLance";
    InitialPositionType["HANDICAP_2PIECES"] = "handicap2Pieces";
    InitialPositionType["HANDICAP_4PIECES"] = "handicap4Pieces";
    InitialPositionType["HANDICAP_6PIECES"] = "handicap6Pieces";
    InitialPositionType["HANDICAP_8PIECES"] = "handicap8Pieces";
    InitialPositionType["HANDICAP_10PIECES"] = "handicap10Pieces";
    InitialPositionType["TSUME_SHOGI"] = "tsumeShogi";
    InitialPositionType["TSUME_SHOGI_2KINGS"] = "tsumeShogi2Kings";
    return InitialPositionType;
}({});
export var InitialPositionSFEN = /*#__PURE__*/ function(InitialPositionSFEN) {
    InitialPositionSFEN["STANDARD"] = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    InitialPositionSFEN["EMPTY"] = "9/9/9/9/9/9/9/9/9 b - 1";
    InitialPositionSFEN["HANDICAP_LANCE"] = "lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_RIGHT_LANCE"] = "1nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_BISHOP"] = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_ROOK"] = "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_ROOK_LANCE"] = "lnsgkgsn1/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_2PIECES"] = "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_4PIECES"] = "1nsgkgsn1/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_6PIECES"] = "2sgkgs2/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_8PIECES"] = "3gkg3/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["HANDICAP_10PIECES"] = "4k4/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
    InitialPositionSFEN["TSUME_SHOGI"] = "4k4/9/9/9/9/9/9/9/9 b 2r2b4g4s4n4l18p 1";
    InitialPositionSFEN["TSUME_SHOGI_2KINGS"] = "4k4/9/9/9/9/9/9/9/4K4 b 2r2b4g4s4n4l18p 1";
    return InitialPositionSFEN;
}({});
export function initialPositionTypeToSFEN(type) {
    return ({
        ["standard"]: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
        ["empty"]: "9/9/9/9/9/9/9/9/9 b - 1",
        ["handicapLance"]: "lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicapRightLance"]: "1nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicapBishop"]: "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicapRook"]: "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicapRookLance"]: "lnsgkgsn1/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicap2Pieces"]: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicap4Pieces"]: "1nsgkgsn1/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicap6Pieces"]: "2sgkgs2/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicap8Pieces"]: "3gkg3/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["handicap10Pieces"]: "4k4/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        ["tsumeShogi"]: "4k4/9/9/9/9/9/9/9/9 b 2r2b4g4s4n4l18p 1",
        ["tsumeShogi2Kings"]: "4k4/9/9/9/9/9/9/9/4K4 b 2r2b4g4s4n4l18p 1"
    })[type];
}
const invalidRankMap = {
    black: {
        pawn: {
            1: true
        },
        lance: {
            1: true
        },
        knight: {
            1: true,
            2: true
        }
    },
    white: {
        pawn: {
            9: true
        },
        lance: {
            9: true
        },
        knight: {
            9: true,
            8: true
        }
    }
};
function isInvalidRank(color, type, rank) {
    const rule = invalidRankMap[color][type];
    return rule ? rule[rank] : false;
}
export function isPromotableRank(color, rank) {
    if (color === Color.BLACK) {
        return rank <= 3;
    }
    return rank >= 7;
}
function pawnExists(color, board, file) {
    for(let rank = 1; rank <= 9; rank += 1){
        const piece = board.at(new Square(file, rank));
        if (piece && piece.type === PieceType.PAWN && piece.color === color) {
            return true;
        }
    }
    return false;
}
export class Position {
    _board = new Board();
    _color = Color.BLACK;
    _blackHand = new Hand();
    _whiteHand = new Hand();
    get board() {
        return this._board;
    }
    get color() {
        return this._color;
    }
    get blackHand() {
        return this._blackHand;
    }
    get whiteHand() {
        return this._whiteHand;
    }
    hand(color) {
        if (color === Color.BLACK) {
            return this._blackHand;
        }
        return this._whiteHand;
    }
    get checked() {
        return this._board.isChecked(this.color);
    }
    createMove(from, to) {
        let pieceType;
        if (from instanceof Square) {
            const piece = this._board.at(from);
            if (!piece) {
                return null;
            }
            pieceType = piece.type;
        } else {
            pieceType = from;
        }
        const capturedPiece = this._board.at(to);
        return new Move(from, to, false, this.color, pieceType, capturedPiece ? capturedPiece.type : null);
    }
    createMoveByUSI(usiMove) {
        const m = parseUSIMove(usiMove);
        if (!m) {
            return null;
        }
        let move = this.createMove(m.from, m.to);
        if (!move) {
            return null;
        }
        if (m.promote) {
            move = move.withPromote();
        }
        return move;
    }
    isPawnDropMate(move) {
        if (move.from instanceof Square) {
            return false;
        }
        if (move.pieceType !== PieceType.PAWN) {
            return false;
        }
        const kingSquare = move.to.neighbor(move.color === Color.BLACK ? Direction.UP : Direction.DOWN);
        const king = this.board.at(kingSquare);
        if (!king || king.type !== PieceType.KING || king.color === move.color) {
            return false;
        }
        const movable = movableDirections(king).find((dir)=>{
            const to = kingSquare.neighbor(dir);
            if (!to.valid) {
                return false;
            }
            const piece = this.board.at(to);
            if (piece && piece.color == king.color) {
                return false;
            }
            return !this.board.hasPower(to, move.color, {
                filled: move.to
            });
        });
        if (movable) {
            return false;
        }
        return !this.board.listSquaresByColor(king.color).find((from)=>{
            return !from.equals(kingSquare) && this.isMovable(from, move.to) && !this.board.isChecked(king.color, {
                filled: move.to,
                ignore: from
            });
        });
    }
    listAttackers(to) {
        return this.board.listNonEmptySquares().filter((from)=>{
            return this.isMovable(from, to);
        });
    }
    listAttackersByPiece(to, piece) {
        return this.board.listSquaresByPiece(piece).filter((from)=>{
            return this.isMovable(from, to);
        });
    }
    isValidMove(move) {
        if (move.from instanceof Square) {
            const target = this._board.at(move.from);
            if (!target || target.color !== this.color || target.type !== move.pieceType) {
                return false;
            }
            if (!this.isMovable(move.from, move.to)) {
                return false;
            }
            const captured = this._board.at(move.to);
            if (captured && captured.color === this.color) {
                return false;
            }
            if (captured === null !== (move.capturedPieceType === null)) {
                return false;
            }
            if (captured && move.capturedPieceType && captured.type !== move.capturedPieceType) {
                return false;
            }
            if (move.promote) {
                if (!target.isPromotable()) {
                    return false;
                }
                if (!isPromotableRank(this.color, move.from.rank) && !isPromotableRank(this.color, move.to.rank)) {
                    return false;
                }
            } else if (isInvalidRank(this.color, target.type, move.to.rank)) {
                return false;
            }
            if (move.pieceType !== PieceType.KING ? this._board.isChecked(this.color, {
                filled: move.to,
                ignore: move.from
            }) : this._board.hasPower(move.to, reverseColor(this.color), {
                ignore: move.from
            })) {
                return false;
            }
        } else {
            if (move.promote) {
                return false;
            }
            if (move.color !== this.color) {
                return false;
            }
            if (this.hand(this.color).count(move.from) === 0) {
                return false;
            }
            if (this._board.at(move.to)) {
                return false;
            }
            if (isInvalidRank(this.color, move.from, move.to.rank)) {
                return false;
            }
            if (move.from === PieceType.PAWN && pawnExists(this.color, this._board, move.to.file)) {
                return false;
            }
            if (this._board.isChecked(this.color, {
                filled: move.to
            })) {
                return false;
            }
            if (this.isPawnDropMate(move)) {
                return false;
            }
        }
        return true;
    }
    doMove(move, opt) {
        if (!(opt && opt.ignoreValidation) && !this.isValidMove(move)) {
            return false;
        }
        if (move.from instanceof Square) {
            const target = this._board.at(move.from);
            if (!target) {
                return false;
            }
            const captured = this._board.at(move.to);
            this._board.remove(move.from);
            this._board.set(move.to, move.promote ? target.promoted() : target);
            if (captured && captured.type !== PieceType.KING) {
                this.hand(this.color).add(captured.unpromoted().type, 1);
            }
        } else {
            this.hand(this.color).reduce(move.from, 1);
            this._board.set(move.to, new Piece(this.color, move.from));
        }
        this._color = reverseColor(this.color);
        return true;
    }
    undoMove(move) {
        this._color = reverseColor(this.color);
        if (move.from instanceof Square) {
            this._board.set(move.from, new Piece(this.color, move.pieceType));
            if (move.capturedPieceType) {
                const capturedPiece = new Piece(reverseColor(this.color), move.capturedPieceType);
                this._board.set(move.to, capturedPiece);
                if (capturedPiece.type !== PieceType.KING) {
                    this.hand(this.color).reduce(capturedPiece.unpromoted().type, 1);
                }
            } else {
                this._board.remove(move.to);
            }
        } else {
            this.hand(this.color).add(move.from, 1);
            this._board.remove(move.to);
        }
    }
    isValidEditing(from, to) {
        if (from instanceof Square) {
            const piece = this._board.at(from);
            if (!piece) {
                return false;
            }
            if (to instanceof Square) {
                if (from.equals(to)) {
                    return false;
                }
            } else if (piece.type === PieceType.KING) {
                return false;
            }
        } else {
            if (!from.color) {
                return false;
            }
            if (this.hand(from.color).count(from.type) === 0) {
                return false;
            }
            if (to instanceof Square) {
                if (this._board.at(to)) {
                    return false;
                }
            } else if (from.color === to) {
                return false;
            }
        }
        return true;
    }
    edit(change) {
        if (change.move) {
            if (!this.isValidEditing(change.move.from, change.move.to)) {
                return false;
            }
            if (!(change.move.from instanceof Square)) {
                this.hand(change.move.from.color).reduce(change.move.from.type, 1);
                if (change.move.to instanceof Square) {
                    this._board.set(change.move.to, change.move.from);
                } else {
                    this.hand(change.move.to).add(change.move.from.type, 1);
                }
            } else if (!(change.move.to instanceof Square)) {
                const piece = this._board.remove(change.move.from);
                this.hand(change.move.to).add(piece.unpromoted().type, 1);
            } else {
                this._board.swap(change.move.from, change.move.to);
            }
        }
        if (change.rotate) {
            const piece = this._board.at(change.rotate);
            if (piece) {
                this._board.set(change.rotate, piece.rotate());
            }
        }
        return true;
    }
    reset(type) {
        this.resetBySFEN(initialPositionTypeToSFEN(type));
    }
    get sfen() {
        return this.getSFEN(1);
    }
    getSFEN(nextPly) {
        let ret = `${this._board.sfen} ${colorToSFEN(this.color)} `;
        ret += Hand.formatSFEN(this._blackHand, this._whiteHand);
        ret += " " + Math.max(nextPly, 1);
        return ret;
    }
    resetBySFEN(sfen) {
        if (!Position.isValidSFEN(sfen)) {
            return false;
        }
        const sections = sfen.split(" ");
        if (sections[0] === "sfen") {
            sections.shift();
        }
        this._board.resetBySFEN(sections[0]);
        this._color = parseSFENColor(sections[1]);
        const hands = Hand.parseSFEN(sections[2]);
        this._blackHand = hands.black;
        this._whiteHand = hands.white;
        return true;
    }
    setColor(color) {
        this._color = color;
    }
    static isValidSFEN(sfen) {
        const sections = sfen.split(" ");
        if ((sections.length === 5 || sections.length === 4) && sections[0] === "sfen") {
            sections.shift();
        }
        if (sections.length !== 4 && sections.length !== 3) {
            return false;
        }
        if (!Board.isValidSFEN(sections[0])) {
            return false;
        }
        if (!isValidSFENColor(sections[1])) {
            return false;
        }
        if (!Hand.isValidSFEN(sections[2])) {
            return false;
        }
        if (sections.length === 4 && !/[0-9]+/.test(sections[3])) {
            return false;
        }
        return true;
    }
    static newBySFEN(sfen) {
        const position = new Position();
        return position.resetBySFEN(sfen) ? position : null;
    }
    isMovable(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const { direction, distance, ok } = vectorToDirectionAndDistance(dx, dy);
        if (!ok) {
            return false;
        }
        const piece = this._board.at(from);
        if (!piece) {
            return false;
        }
        switch(resolveMoveType(piece, direction)){
            default:
                return false;
            case MoveType.SHORT:
                return distance === 1;
            case MoveType.LONG:
                {
                    const d = directionToDeltaMap[direction];
                    for(let square = from.neighbor(d.x, d.y); square.valid; square = square.neighbor(d.x, d.y)){
                        if (square.equals(to)) {
                            return true;
                        }
                        if (this._board.at(square)) {
                            return false;
                        }
                    }
                    return false;
                }
        }
    }
    copyFrom(position) {
        this._board.copyFrom(position._board);
        this._color = position.color;
        this._blackHand.copyFrom(position._blackHand);
        this._whiteHand.copyFrom(position._whiteHand);
    }
    clone() {
        const position = new Position();
        position.copyFrom(this);
        return position;
    }
}
export function countExistingPieces(position) {
    const result = {
        pawn: 0,
        lance: 0,
        knight: 0,
        silver: 0,
        gold: 0,
        bishop: 0,
        rook: 0,
        king: 0,
        promPawn: 0,
        promLance: 0,
        promKnight: 0,
        promSilver: 0,
        horse: 0,
        dragon: 0
    };
    Square.all.forEach((square)=>{
        const piece = position.board.at(square);
        if (piece) {
            result[piece.type] += 1;
        }
    });
    position.blackHand.forEach((pieceType, n)=>{
        result[pieceType] += n;
    });
    position.whiteHand.forEach((pieceType, n)=>{
        result[pieceType] += n;
    });
    return result;
}
export function countNotExistingPieces(position) {
    const existed = countExistingPieces(position);
    return {
        pawn: 18 - existed.pawn - existed.promPawn,
        lance: 4 - existed.lance - existed.promLance,
        knight: 4 - existed.knight - existed.promKnight,
        silver: 4 - existed.silver - existed.promSilver,
        gold: 4 - existed.gold,
        bishop: 2 - existed.bishop - existed.horse,
        rook: 2 - existed.rook - existed.dragon,
        king: 2 - existed.king,
        promPawn: 0,
        promLance: 0,
        promKnight: 0,
        promSilver: 0,
        horse: 0,
        dragon: 0
    };
}
export var JishogiDeclarationRule = /*#__PURE__*/ function(JishogiDeclarationRule) {
    JishogiDeclarationRule["GENERAL24"] = "general24";
    JishogiDeclarationRule["GENERAL27"] = "general27";
    return JishogiDeclarationRule;
}({});
export var JishogiDeclarationResult = /*#__PURE__*/ function(JishogiDeclarationResult) {
    JishogiDeclarationResult["WIN"] = "win";
    JishogiDeclarationResult["LOSE"] = "lose";
    JishogiDeclarationResult["DRAW"] = "draw";
    return JishogiDeclarationResult;
}({});
function invadingPieces(board, color) {
    return board.listNonEmptySquares().filter((square)=>{
        if (!isPromotableRank(color, square.rank)) {
            return false;
        }
        const piece = board.at(square);
        return piece?.color === color && piece?.type !== PieceType.KING;
    }).map((square)=>board.at(square));
}
export function countJishogiPoint(position, color) {
    let point = 0;
    Square.all.forEach((square)=>{
        const piece = position.board.at(square);
        if (piece?.color === color && piece.type !== PieceType.KING) {
            const type = piece.unpromoted().type;
            point += type === PieceType.BISHOP || type === PieceType.ROOK ? 5 : 1;
        }
    });
    const hand = position.hand(color);
    point += hand.count(PieceType.PAWN) + hand.count(PieceType.LANCE) + hand.count(PieceType.KNIGHT) + hand.count(PieceType.SILVER) + hand.count(PieceType.GOLD) + hand.count(PieceType.BISHOP) * 5 + hand.count(PieceType.ROOK) * 5;
    if (color === Color.WHITE) {
        const notExisting = countNotExistingPieces(position);
        point += notExisting.pawn + notExisting.lance + notExisting.knight + notExisting.silver + notExisting.gold + notExisting.bishop * 5 + notExisting.rook * 5;
    }
    return point;
}
export function countJishogiDeclarationPoint(position, color) {
    let point = 0;
    for (const piece of invadingPieces(position.board, color)){
        const type = piece.unpromoted().type;
        point += type === PieceType.BISHOP || type === PieceType.ROOK ? 5 : 1;
    }
    const hand = position.hand(color);
    point += hand.count(PieceType.PAWN) + hand.count(PieceType.LANCE) + hand.count(PieceType.KNIGHT) + hand.count(PieceType.SILVER) + hand.count(PieceType.GOLD) + hand.count(PieceType.BISHOP) * 5 + hand.count(PieceType.ROOK) * 5;
    if (color === Color.WHITE) {
        const notExisting = countNotExistingPieces(position);
        point += notExisting.pawn + notExisting.lance + notExisting.knight + notExisting.silver + notExisting.gold + notExisting.bishop * 5 + notExisting.rook * 5;
    }
    return point;
}
export function judgeJishogiDeclaration(rule, position, color) {
    if (position.color !== color) {
        return "lose";
    }
    const king = position.board.findKing(color);
    if (!king || !isPromotableRank(color, king.rank)) {
        return "lose";
    }
    if (position.board.isChecked(color)) {
        return "lose";
    }
    if (invadingPieces(position.board, color).length < 10) {
        return "lose";
    }
    const point = countJishogiDeclarationPoint(position, color);
    if (rule === "general24") {
        return point >= 31 ? "win" : point >= 24 ? "draw" : "lose";
    }
    if (color === Color.BLACK) {
        return point >= 28 ? "win" : "lose";
    } else {
        return point >= 27 ? "win" : "lose";
    }
}
