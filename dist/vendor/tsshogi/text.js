import { Color } from "./color.js";
import { HDirection, VDirection, directionToHDirection, directionToVDirection, reverseDirection } from "./direction.js";
import { InvalidMoveError } from "./errors.js";
import { Move, SpecialMoveType, isKnownSpecialMove } from "./move.js";
import { PieceType, Piece, isPromotable } from "./piece.js";
import { isPromotableRank } from "./position.js";
import { Square } from "./square.js";
const stringToNumberMap = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "１": 1,
    "２": 2,
    "３": 3,
    "４": 4,
    "５": 5,
    "６": 6,
    "７": 7,
    "８": 8,
    "９": 9,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
    十三: 13,
    十四: 14,
    十五: 15,
    十六: 16,
    十七: 17,
    十八: 18
};
const stringToPieceTypeMap = {
    王: PieceType.KING,
    玉: PieceType.KING,
    飛: PieceType.ROOK,
    龍: PieceType.DRAGON,
    竜: PieceType.DRAGON,
    角: PieceType.BISHOP,
    馬: PieceType.HORSE,
    金: PieceType.GOLD,
    銀: PieceType.SILVER,
    成銀: PieceType.PROM_SILVER,
    全: PieceType.PROM_SILVER,
    桂: PieceType.KNIGHT,
    成桂: PieceType.PROM_KNIGHT,
    圭: PieceType.PROM_KNIGHT,
    香: PieceType.LANCE,
    成香: PieceType.PROM_LANCE,
    杏: PieceType.PROM_LANCE,
    歩: PieceType.PAWN,
    と: PieceType.PROM_PAWN
};
export function stringToNumber(s) {
    return stringToNumberMap[s];
}
export function stringToPieceType(piece) {
    return stringToPieceTypeMap[piece];
}
const kanjiNumberStrings = [
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "十一",
    "十二",
    "十三",
    "十四",
    "十五",
    "十六",
    "十七",
    "十八"
];
const fileStrings = [
    "１",
    "２",
    "３",
    "４",
    "５",
    "６",
    "７",
    "８",
    "９"
];
export function numberToKanji(n) {
    return kanjiNumberStrings[n - 1];
}
export function fileToMultiByteChar(file) {
    return fileStrings[file - 1];
}
export function rankToKanji(rank) {
    return kanjiNumberStrings[rank - 1];
}
const pieceTypeToStringForMoveMap = {
    king: "玉",
    rook: "飛",
    dragon: "龍",
    bishop: "角",
    horse: "馬",
    gold: "金",
    silver: "銀",
    promSilver: "成銀",
    knight: "桂",
    promKnight: "成桂",
    lance: "香",
    promLance: "成香",
    pawn: "歩",
    promPawn: "と"
};
export function pieceTypeToStringForMove(pieceType) {
    return pieceTypeToStringForMoveMap[pieceType];
}
const pieceTypeToStringForBoardMap = {
    king: "玉",
    rook: "飛",
    dragon: "龍",
    bishop: "角",
    horse: "馬",
    gold: "金",
    silver: "銀",
    promSilver: "全",
    knight: "桂",
    promKnight: "圭",
    lance: "香",
    promLance: "杏",
    pawn: "歩",
    promPawn: "と"
};
export function pieceTypeToStringForBoard(pieceType) {
    return pieceTypeToStringForBoardMap[pieceType];
}
const specialMoveToDisplayStringMap = {
    [SpecialMoveType.START]: "開始局面",
    [SpecialMoveType.RESIGN]: "投了",
    [SpecialMoveType.INTERRUPT]: "中断",
    [SpecialMoveType.MAX_MOVES]: "最大手数",
    [SpecialMoveType.IMPASS]: "持将棋",
    [SpecialMoveType.DRAW]: "引き分け",
    [SpecialMoveType.REPETITION_DRAW]: "千日手",
    [SpecialMoveType.MATE]: "詰み",
    [SpecialMoveType.NO_MATE]: "不詰",
    [SpecialMoveType.TIMEOUT]: "切れ負け",
    [SpecialMoveType.FOUL_WIN]: "反則勝ち",
    [SpecialMoveType.FOUL_LOSE]: "反則負け",
    [SpecialMoveType.ENTERING_OF_KING]: "入玉",
    [SpecialMoveType.WIN_BY_DEFAULT]: "不戦勝",
    [SpecialMoveType.LOSE_BY_DEFAULT]: "不戦敗",
    [SpecialMoveType.TRY]: "トライ"
};
export function formatSpecialMove(move, color) {
    if (typeof move !== "string" && !isKnownSpecialMove(move)) {
        return move.name;
    }
    const moveType = typeof move === "string" ? move : move.type;
    if (color !== undefined) {
        if (moveType === SpecialMoveType.FOUL_LOSE) {
            return color === Color.BLACK ? "先手の反則負け" : "後手の反則負け";
        } else if (moveType === SpecialMoveType.FOUL_WIN) {
            return color === Color.BLACK ? "後手の反則負け" : "先手の反則負け";
        }
    }
    return specialMoveToDisplayStringMap[moveType];
}
export function getDirectionModifier(move, position) {
    const piece = new Piece(move.color, move.pieceType);
    const others = position.listAttackersByPiece(move.to, piece).filter((square)=>{
        return !(move.from instanceof Square) || !square.equals(move.from);
    });
    if (move.from instanceof Square) {
        let ret = "";
        let myDir = move.from.directionTo(move.to);
        myDir = move.color === Color.BLACK ? myDir : reverseDirection(myDir);
        const myVDir = directionToVDirection(myDir);
        const myHDir = directionToHDirection(myDir);
        const otherDirs = others.map((square)=>{
            const dir = square.directionTo(move.to);
            return move.color === Color.BLACK ? dir : reverseDirection(dir);
        });
        const vDirections = otherDirs.filter((dir)=>directionToHDirection(dir) == myHDir).map((dir)=>directionToVDirection(dir));
        const hDirections = otherDirs.filter((dir)=>directionToVDirection(dir) == myVDir).map((dir)=>directionToHDirection(dir));
        let noVertical = false;
        if (hDirections.length) {
            if (move.pieceType === PieceType.HORSE || move.pieceType === PieceType.DRAGON) {
                if (myHDir === HDirection.LEFT || myHDir === HDirection.NONE && hDirections[0] === HDirection.RIGHT) {
                    ret += "右";
                } else if (myHDir === HDirection.RIGHT || myHDir === HDirection.NONE && hDirections[0] === HDirection.LEFT) {
                    ret += "左";
                }
            } else {
                switch(myHDir){
                    case HDirection.LEFT:
                        ret += "右";
                        break;
                    case HDirection.NONE:
                        ret += "直";
                        noVertical = true;
                        break;
                    case HDirection.RIGHT:
                        ret += "左";
                        break;
                }
            }
        }
        if (!noVertical && (vDirections.length || !hDirections.length && others.length)) {
            switch(myVDir){
                case VDirection.DOWN:
                    ret += "引";
                    break;
                case VDirection.NONE:
                    ret += "寄";
                    break;
                case VDirection.UP:
                    ret += "上";
                    break;
            }
        }
        return ret;
    } else if (others.length) {
        return "打";
    }
    return "";
}
export function formatMove(position, move, opt) {
    let ret = "";
    switch(move.color){
        case Color.BLACK:
            ret += opt?.compatible ? "▲" : "☗";
            break;
        case Color.WHITE:
            ret += opt?.compatible ? "△" : "☖";
            break;
    }
    if (opt?.lastMove && opt.lastMove.to.equals(move.to)) {
        ret += "同　";
    } else {
        ret += fileToMultiByteChar(move.to.file);
        ret += rankToKanji(move.to.rank);
    }
    ret += pieceTypeToStringForMove(move.pieceType);
    ret += getDirectionModifier(move, position);
    if (move.from instanceof Square) {
        if (move.promote) {
            ret += "成";
        } else if (move.from instanceof Square && isPromotable(move.pieceType) && (isPromotableRank(move.color, move.from.rank) || isPromotableRank(move.color, move.to.rank))) {
            ret += "不成";
        }
    }
    return ret;
}
export function formatPV(position, pv) {
    let ret = "";
    let lastMove;
    const p = position.clone();
    for (const move of pv){
        ret += `${formatMove(p, move, {
            lastMove,
            compatible: true
        })}`;
        if (!p.doMove(move, {
            ignoreValidation: true
        })) {
            break;
        }
        lastMove = move;
    }
    return ret;
}
const moveRegExp = /^[▲△▼▽☗☖]?([１２３４５６７８９一二三四五六七八九1-9]{2}|同)(王|玉|飛|龍|竜|角|馬|金|銀|成銀|全|桂|成桂|圭|香|成香|杏|歩|と)(左|直|右|)(引|寄|上|)(成|不成|打|)(\([1-9][1-9]\)|)/;
const ignoredKI2MoveNames = new Set([
    "中断",
    "投了",
    "持将棋",
    "千日手",
    "詰み",
    "詰",
    "不詰",
    "切れ負け",
    "反則勝ち",
    "反則負け",
    "入玉勝ち",
    "不戦勝",
    "不戦敗"
]);
export function parsePV(position, text) {
    return parseMoves(position, text)[0];
}
export function parseMoves(position, text, lastMove) {
    const clean = text.replaceAll(/[\s\u3000]/g, "");
    const sections = [];
    let lastIndex = 0;
    for(let i = 1; i <= clean.length; i++){
        const char = clean[i];
        if (!char || char === "▲" || char === "△" || char === "▼" || char === "▽" || char === "☗" || char === "☖") {
            sections.push(clean.substring(lastIndex, i));
            lastIndex = i;
        }
    }
    const p = position.clone();
    const pv = [];
    for (const section of sections){
        if (ignoredKI2MoveNames.has(section.substring(1))) {
            break;
        }
        const result = moveRegExp.exec(section);
        if (!result) {
            return [
                pv,
                new InvalidMoveError(section)
            ];
        }
        const toStr = result[1];
        const pieceType = stringToPieceType(result[2]);
        const horStr = result[3];
        const verStr = result[4];
        const promOrDropStr = result[5];
        const fromStr = result[6];
        let to;
        if (toStr.startsWith("同")) {
            if (pv.length > 0) {
                to = pv[pv.length - 1].to;
            } else if (lastMove) {
                to = lastMove.to;
            } else {
                return [
                    pv,
                    new InvalidMoveError(section)
                ];
            }
        } else {
            const file = stringToNumber(toStr[0]);
            const rank = stringToNumber(toStr[1]);
            to = new Square(file, rank);
        }
        let from;
        if (promOrDropStr === "打") {
            from = pieceType;
        } else if (fromStr) {
            const file = stringToNumber(fromStr[1]);
            const rank = stringToNumber(fromStr[2]);
            from = new Square(file, rank);
        } else {
            let squares = p.listAttackersByPiece(to, new Piece(p.color, pieceType)).filter((square)=>{
                let dir = square.directionTo(to);
                dir = p.color === Color.BLACK ? dir : reverseDirection(dir);
                const vDir = directionToVDirection(dir);
                const hDir = directionToHDirection(dir);
                if (verStr.indexOf("引") >= 0 && vDir !== VDirection.DOWN) {
                    return false;
                }
                if (verStr.indexOf("寄") >= 0 && vDir !== VDirection.NONE) {
                    return false;
                }
                if ((verStr.indexOf("上") >= 0 || verStr.indexOf("行") >= 0) && vDir !== VDirection.UP) {
                    return false;
                }
                if (horStr.indexOf("直") >= 0 && (hDir !== HDirection.NONE || vDir !== VDirection.UP)) {
                    return false;
                }
                if (pieceType === PieceType.HORSE || pieceType === PieceType.DRAGON) {
                    if (horStr.indexOf("左") >= 0 && hDir === HDirection.LEFT) {
                        return false;
                    }
                    if (horStr.indexOf("右") >= 0 && hDir === HDirection.RIGHT) {
                        return false;
                    }
                } else {
                    if (horStr.indexOf("左") >= 0 && hDir !== HDirection.RIGHT) {
                        return false;
                    }
                    if (horStr.indexOf("右") >= 0 && hDir !== HDirection.LEFT) {
                        return false;
                    }
                }
                return true;
            });
            if (squares.length === 2 && (pieceType === PieceType.HORSE || pieceType === PieceType.DRAGON)) {
                squares = squares.filter((square)=>{
                    let dir = square.directionTo(to);
                    dir = p.color === Color.BLACK ? dir : reverseDirection(dir);
                    const hDir = directionToHDirection(dir);
                    return hDir !== HDirection.NONE;
                });
            }
            if (squares.length === 1) {
                from = squares[0];
            } else if (squares.length === 0 && p.hand(p.color).count(pieceType) !== 0) {
                from = pieceType;
            } else {
                return [
                    pv,
                    new InvalidMoveError(section)
                ];
            }
        }
        let move = p.createMove(from, to);
        if (!move) {
            return [
                pv,
                new InvalidMoveError(section)
            ];
        }
        if (promOrDropStr === "成") {
            move = move.withPromote();
        }
        if (!p.doMove(move, {
            ignoreValidation: true
        })) {
            return [
                pv,
                new InvalidMoveError(section)
            ];
        }
        pv.push(move);
    }
    return [
        pv,
        undefined
    ];
}
