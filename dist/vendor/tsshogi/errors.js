export class InvalidPieceNameError extends Error {
    data;
    constructor(data){
        super(`Invalid piece name: ${data}`), this.data = data;
        this.name = "InvalidPieceNameError";
    }
}
export class InvalidTurnError extends Error {
    data;
    constructor(data){
        super(`Invalid turn: ${data}`), this.data = data;
        this.name = "InvalidTurnError";
    }
}
export class InvalidMoveError extends Error {
    data;
    constructor(data){
        super(`Invalid move: ${data}`), this.data = data;
        this.name = "InvalidMoveError";
    }
}
export class InvalidMoveNumberError extends Error {
    data;
    constructor(data){
        super(`Invalid move number: ${data}`), this.data = data;
        this.name = "InvalidMoveNumberError";
    }
}
export class InvalidDestinationError extends Error {
    data;
    constructor(data){
        super(`Invalid destination: ${data}`), this.data = data;
        this.name = "InvalidDestinationError";
    }
}
export class PieceNotExistsError extends Error {
    data;
    constructor(data){
        super(`Piece not exists: ${data}`), this.data = data;
        this.name = "PieceNotExistsError";
    }
}
export class InvalidLineError extends Error {
    data;
    constructor(data){
        super(`Invalid line: ${data}`), this.data = data;
        this.name = "InvalidLineError";
    }
}
export class InvalidHandicapError extends Error {
    data;
    constructor(data){
        super(`Invalid handicap: ${data}`), this.data = data;
        this.name = "InvalidHandicapError";
    }
}
export class InvalidBoardError extends Error {
    data;
    constructor(data){
        super(`Invalid board: ${data}`), this.data = data;
        this.name = "InvalidBoardError";
    }
}
export class InvalidHandPieceError extends Error {
    data;
    constructor(data){
        super(`Invalid hand piece: ${data}`), this.data = data;
        this.name = "InvalidHandPieceError";
    }
}
export class InvalidUSIError extends Error {
    data;
    constructor(data){
        super(`Invalid USI: ${data}`), this.data = data;
        this.name = "InvalidUSIError";
    }
}
