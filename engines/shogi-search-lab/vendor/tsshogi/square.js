import { Direction, vectorToDirectionAndDistance } from "./direction.js";
function usiFileToNumber(usi) {
    return usi >= "1" && usi <= "9" ? Number(usi) : null;
}
function usiRankToNumber(usi) {
    switch(usi){
        case "a":
            return 1;
        case "b":
            return 2;
        case "c":
            return 3;
        case "d":
            return 4;
        case "e":
            return 5;
        case "f":
            return 6;
        case "g":
            return 7;
        case "h":
            return 8;
        case "i":
            return 9;
        default:
            return null;
    }
}
const sfenRanks = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i"
];
export class Square {
    file;
    rank;
    constructor(file, rank){
        this.file = file;
        this.rank = rank;
    }
    get x() {
        return 9 - this.file;
    }
    get y() {
        return this.rank - 1;
    }
    get index() {
        return this.y * 9 + this.x;
    }
    get opposite() {
        return new Square(10 - this.file, 10 - this.rank);
    }
    neighbor(arg0, arg1) {
        switch(arg0){
            case Direction.UP:
                return new Square(this.file, this.rank - 1);
            case Direction.DOWN:
                return new Square(this.file, this.rank + 1);
            case Direction.LEFT:
                return new Square(this.file + 1, this.rank);
            case Direction.RIGHT:
                return new Square(this.file - 1, this.rank);
            case Direction.LEFT_UP:
                return new Square(this.file + 1, this.rank - 1);
            case Direction.RIGHT_UP:
                return new Square(this.file - 1, this.rank - 1);
            case Direction.LEFT_DOWN:
                return new Square(this.file + 1, this.rank + 1);
            case Direction.RIGHT_DOWN:
                return new Square(this.file - 1, this.rank + 1);
            case Direction.LEFT_UP_KNIGHT:
                return new Square(this.file + 1, this.rank - 2);
            case Direction.RIGHT_UP_KNIGHT:
                return new Square(this.file - 1, this.rank - 2);
            case Direction.LEFT_DOWN_KNIGHT:
                return new Square(this.file + 1, this.rank + 2);
            case Direction.RIGHT_DOWN_KNIGHT:
                return new Square(this.file - 1, this.rank + 2);
        }
        const dx = arg0;
        const dy = arg1;
        return new Square(this.file - dx, this.rank + dy);
    }
    directionTo(square) {
        return vectorToDirectionAndDistance(square.x - this.x, square.y - this.y).direction;
    }
    get valid() {
        return this.file >= 1 && this.file <= 9 && this.rank >= 1 && this.rank <= 9;
    }
    equals(square) {
        return !!square && this.file === square.file && this.rank === square.rank;
    }
    static newByXY(x, y) {
        return new Square(9 - x, y + 1);
    }
    static newByIndex(index) {
        return new Square(9 - index % 9, Math.trunc(index / 9) + 1);
    }
    static all = [];
    get sfen() {
        return this.usi;
    }
    get usi() {
        return this.file + sfenRanks[this.rank - 1];
    }
    static parseSFENSquare(sfen) {
        return Square.newByUSI(sfen);
    }
    static newByUSI(usi) {
        const file = usiFileToNumber(usi[0]);
        const rank = usiRankToNumber(usi[1]);
        if (!file || !rank) {
            return null;
        }
        return new Square(file, rank);
    }
}
for(let index = 0; index < 81; index += 1){
    Square.all.push(Square.newByIndex(index));
}
