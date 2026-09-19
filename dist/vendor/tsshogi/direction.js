import { Piece, PieceType } from "./piece.js";
export var Direction = /*#__PURE__*/ function(Direction) {
    Direction["UP"] = "up";
    Direction["DOWN"] = "down";
    Direction["LEFT"] = "left";
    Direction["RIGHT"] = "right";
    Direction["LEFT_UP"] = "left_up";
    Direction["RIGHT_UP"] = "right_up";
    Direction["LEFT_DOWN"] = "left_down";
    Direction["RIGHT_DOWN"] = "right_down";
    Direction["LEFT_UP_KNIGHT"] = "left_up_knight";
    Direction["RIGHT_UP_KNIGHT"] = "right_up_knight";
    Direction["LEFT_DOWN_KNIGHT"] = "left_down_knight";
    Direction["RIGHT_DOWN_KNIGHT"] = "right_down_knight";
    return Direction;
}({});
const reverseMap = {
    up: "down",
    down: "up",
    left: "right",
    right: "left",
    left_up: "right_down",
    right_up: "left_down",
    left_down: "right_up",
    right_down: "left_up",
    left_up_knight: "right_down_knight",
    right_up_knight: "left_down_knight",
    left_down_knight: "right_up_knight",
    right_down_knight: "left_up_knight"
};
export function reverseDirection(dir) {
    return reverseMap[dir];
}
export const directions = [
    "up",
    "down",
    "left",
    "right",
    "left_up",
    "right_up",
    "left_down",
    "right_down",
    "left_up_knight",
    "right_up_knight",
    "left_down_knight",
    "right_down_knight"
];
export var MoveType = /*#__PURE__*/ function(MoveType) {
    MoveType["SHORT"] = "short";
    MoveType["LONG"] = "long";
    return MoveType;
}({});
const movableDirectionMap = {
    black: {
        pawn: {
            up: "short"
        },
        lance: {
            up: "long"
        },
        knight: {
            left_up_knight: "short",
            right_up_knight: "short"
        },
        silver: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left_down: "short",
            right_down: "short"
        },
        gold: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        bishop: {
            left_up: "long",
            right_up: "long",
            left_down: "long",
            right_down: "long"
        },
        rook: {
            up: "long",
            left: "long",
            right: "long",
            down: "long"
        },
        king: {
            left_down: "short",
            right_down: "short",
            left_up: "short",
            right_up: "short",
            down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        promPawn: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        promLance: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        promKnight: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        promSilver: {
            left_up: "short",
            up: "short",
            right_up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        horse: {
            left_up: "long",
            right_up: "long",
            left_down: "long",
            right_down: "long",
            up: "short",
            left: "short",
            right: "short",
            down: "short"
        },
        dragon: {
            up: "long",
            left: "long",
            right: "long",
            down: "long",
            left_up: "short",
            right_up: "short",
            left_down: "short",
            right_down: "short"
        }
    },
    white: {
        pawn: {
            down: "short"
        },
        lance: {
            down: "long"
        },
        knight: {
            left_down_knight: "short",
            right_down_knight: "short"
        },
        silver: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left_up: "short",
            right_up: "short"
        },
        gold: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        bishop: {
            left_down: "long",
            right_down: "long",
            left_up: "long",
            right_up: "long"
        },
        rook: {
            down: "long",
            left: "long",
            right: "long",
            up: "long"
        },
        king: {
            left_down: "short",
            right_down: "short",
            left_up: "short",
            right_up: "short",
            down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        promPawn: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        promLance: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        promKnight: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        promSilver: {
            left_down: "short",
            down: "short",
            right_down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        horse: {
            left_down: "long",
            right_down: "long",
            left_up: "long",
            right_up: "long",
            down: "short",
            left: "short",
            right: "short",
            up: "short"
        },
        dragon: {
            down: "long",
            left: "long",
            right: "long",
            up: "long",
            left_down: "short",
            right_down: "short",
            left_up: "short",
            right_up: "short"
        }
    }
};
export function movableDirections(piece) {
    return Object.keys(movableDirectionMap[piece.color][piece.type]);
}
export function resolveMoveType(piece, direction) {
    return movableDirectionMap[piece.color][piece.type][direction];
}
export const directionToDeltaMap = {
    up: {
        x: 0,
        y: -1
    },
    down: {
        x: 0,
        y: 1
    },
    left: {
        x: -1,
        y: 0
    },
    right: {
        x: 1,
        y: 0
    },
    left_up: {
        x: -1,
        y: -1
    },
    right_up: {
        x: 1,
        y: -1
    },
    left_down: {
        x: -1,
        y: 1
    },
    right_down: {
        x: 1,
        y: 1
    },
    left_up_knight: {
        x: -1,
        y: -2
    },
    right_up_knight: {
        x: 1,
        y: -2
    },
    left_down_knight: {
        x: -1,
        y: 2
    },
    right_down_knight: {
        x: 1,
        y: 2
    }
};
export function vectorToDirectionAndDistance(x, y) {
    if (x === 1 && y === -2) {
        return {
            direction: "right_up_knight",
            distance: 1,
            ok: true
        };
    }
    if (x === -1 && y === -2) {
        return {
            direction: "left_up_knight",
            distance: 1,
            ok: true
        };
    }
    if (x === 1 && y === 2) {
        return {
            direction: "right_down_knight",
            distance: 1,
            ok: true
        };
    }
    if (x === -1 && y === 2) {
        return {
            direction: "left_down_knight",
            distance: 1,
            ok: true
        };
    }
    if (x !== 0 && y !== 0 && Math.abs(x) !== Math.abs(y)) {
        return {
            direction: "",
            distance: 0,
            ok: false
        };
    }
    let dx = x;
    let dy = y;
    let distance = 0;
    if (dx !== 0) {
        distance = Math.abs(dx);
        dx /= distance;
    }
    if (dy !== 0) {
        distance = Math.abs(dy);
        dy /= distance;
    }
    if (dx === -1 && dy === -1) {
        return {
            direction: "left_up",
            distance,
            ok: true
        };
    }
    if (dx === 0 && dy === -1) {
        return {
            direction: "up",
            distance,
            ok: true
        };
    }
    if (dx === 1 && dy === -1) {
        return {
            direction: "right_up",
            distance,
            ok: true
        };
    }
    if (dx === -1 && dy === 0) {
        return {
            direction: "left",
            distance,
            ok: true
        };
    }
    if (dx === 1 && dy === 0) {
        return {
            direction: "right",
            distance,
            ok: true
        };
    }
    if (dx === -1 && dy === 1) {
        return {
            direction: "left_down",
            distance,
            ok: true
        };
    }
    if (dx === 0 && dy === 1) {
        return {
            direction: "down",
            distance,
            ok: true
        };
    }
    if (dx === 1 && dy === 1) {
        return {
            direction: "right_down",
            distance,
            ok: true
        };
    }
    return {
        direction: "",
        distance: 0,
        ok: false
    };
}
export var VDirection = /*#__PURE__*/ function(VDirection) {
    VDirection["UP"] = "up";
    VDirection["NONE"] = "none";
    VDirection["DOWN"] = "down";
    return VDirection;
}({});
export function directionToVDirection(direction) {
    switch(direction){
        case "up":
        case "left_up":
        case "right_up":
        case "left_up_knight":
        case "right_up_knight":
            return "up";
        case "down":
        case "left_down":
        case "right_down":
        case "left_down_knight":
        case "right_down_knight":
            return "down";
        default:
            return "none";
    }
}
export var HDirection = /*#__PURE__*/ function(HDirection) {
    HDirection["LEFT"] = "left";
    HDirection["NONE"] = "none";
    HDirection["RIGHT"] = "right";
    return HDirection;
}({});
export function directionToHDirection(direction) {
    switch(direction){
        case "left":
        case "left_up":
        case "left_down":
        case "left_up_knight":
        case "left_down_knight":
            return "left";
        case "right":
        case "right_up":
        case "right_down":
        case "right_up_knight":
        case "right_down_knight":
            return "right";
        default:
            return "none";
    }
}
