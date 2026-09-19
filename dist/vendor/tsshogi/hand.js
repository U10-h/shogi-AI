import { Piece, PieceType } from "./piece.js";
import { Color } from "./color.js";
function buildSFEN(n, piece) {
    if (n === 0) {
        return "";
    }
    return (n !== 1 ? n : "") + piece.sfen;
}
export class Hand {
    pieces;
    constructor(){
        this.pieces = new Map();
        this.pieces.set(PieceType.PAWN, 0);
        this.pieces.set(PieceType.LANCE, 0);
        this.pieces.set(PieceType.KNIGHT, 0);
        this.pieces.set(PieceType.SILVER, 0);
        this.pieces.set(PieceType.GOLD, 0);
        this.pieces.set(PieceType.BISHOP, 0);
        this.pieces.set(PieceType.ROOK, 0);
    }
    get counts() {
        return [
            {
                type: PieceType.ROOK,
                count: this.count(PieceType.ROOK)
            },
            {
                type: PieceType.BISHOP,
                count: this.count(PieceType.BISHOP)
            },
            {
                type: PieceType.GOLD,
                count: this.count(PieceType.GOLD)
            },
            {
                type: PieceType.SILVER,
                count: this.count(PieceType.SILVER)
            },
            {
                type: PieceType.KNIGHT,
                count: this.count(PieceType.KNIGHT)
            },
            {
                type: PieceType.LANCE,
                count: this.count(PieceType.LANCE)
            },
            {
                type: PieceType.PAWN,
                count: this.count(PieceType.PAWN)
            }
        ];
    }
    count(pieceType) {
        return Math.max(this.pieces.get(pieceType), 0);
    }
    set(pieceType, count) {
        this.pieces.set(pieceType, count);
    }
    add(pieceType, n) {
        let c = this.pieces.get(pieceType);
        c += n;
        this.pieces.set(pieceType, c);
        return c;
    }
    reduce(pieceType, n) {
        let c = this.pieces.get(pieceType);
        c -= n;
        this.pieces.set(pieceType, c);
        return c;
    }
    forEach(handler) {
        handler(PieceType.PAWN, this.pieces.get(PieceType.PAWN));
        handler(PieceType.LANCE, this.pieces.get(PieceType.LANCE));
        handler(PieceType.KNIGHT, this.pieces.get(PieceType.KNIGHT));
        handler(PieceType.SILVER, this.pieces.get(PieceType.SILVER));
        handler(PieceType.GOLD, this.pieces.get(PieceType.GOLD));
        handler(PieceType.BISHOP, this.pieces.get(PieceType.BISHOP));
        handler(PieceType.ROOK, this.pieces.get(PieceType.ROOK));
    }
    get sfenBlack() {
        return this.formatSFEN(Color.BLACK);
    }
    get sfenWhite() {
        return this.formatSFEN(Color.WHITE);
    }
    formatSFEN(color) {
        let ret = "";
        ret += buildSFEN(this.count(PieceType.ROOK), new Piece(color, PieceType.ROOK));
        ret += buildSFEN(this.count(PieceType.BISHOP), new Piece(color, PieceType.BISHOP));
        ret += buildSFEN(this.count(PieceType.GOLD), new Piece(color, PieceType.GOLD));
        ret += buildSFEN(this.count(PieceType.SILVER), new Piece(color, PieceType.SILVER));
        ret += buildSFEN(this.count(PieceType.KNIGHT), new Piece(color, PieceType.KNIGHT));
        ret += buildSFEN(this.count(PieceType.LANCE), new Piece(color, PieceType.LANCE));
        ret += buildSFEN(this.count(PieceType.PAWN), new Piece(color, PieceType.PAWN));
        if (ret === "") {
            return "-";
        }
        return ret;
    }
    static formatSFEN(black, white) {
        const b = black.sfenBlack;
        const w = white.sfenWhite;
        if (b === "-" && w === "-") {
            return "-";
        }
        if (w === "-") {
            return b;
        }
        if (b === "-") {
            return w;
        }
        return b + w;
    }
    static isValidSFEN(sfen) {
        if (sfen === "-") {
            return true;
        }
        return /^(?:[0-9]{0,2}[PLNSGBRplnsgbr])+$/.test(sfen);
    }
    static parseSFEN(sfen) {
        if (sfen === "-") {
            return {
                black: new Hand(),
                white: new Hand()
            };
        }
        const sections = sfen.match(/([0-9]{0,2}[PLNSGBRplnsgbr])/g);
        if (!sections) {
            return null;
        }
        const black = new Hand();
        const white = new Hand();
        for(let i = 0; i < sections.length; i += 1){
            const section = sections[i];
            let n = 1;
            if (section.length >= 2) {
                n = Number(section.substring(0, section.length - 1));
            }
            const piece = Piece.newBySFEN(section[section.length - 1]);
            if (piece.color === Color.BLACK) {
                black.add(piece.type, n);
            } else {
                white.add(piece.type, n);
            }
        }
        return {
            black,
            white
        };
    }
    copyFrom(hand) {
        hand.pieces.forEach((n, pieceType)=>{
            this.pieces.set(pieceType, n);
        });
    }
}
