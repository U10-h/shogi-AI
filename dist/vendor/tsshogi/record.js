import { millisecondsToHHMMSS, millisecondsToMSS } from "./helpers/time.js";
import { Color, reverseColor } from "./color.js";
import { InvalidMoveError, InvalidUSIError } from "./errors.js";
import { Move, SpecialMoveType, areSameMoves, parseUSIMove, specialMove } from "./move.js";
import { InitialPositionSFEN, Position } from "./position.js";
import { formatMove, formatSpecialMove } from "./text.js";
import { PieceType } from "./piece.js";
import { Square } from "./square.js";
const usenHandTable = {
    [PieceType.PAWN]: 81 + 10,
    [PieceType.LANCE]: 81 + 11,
    [PieceType.KNIGHT]: 81 + 12,
    [PieceType.SILVER]: 81 + 13,
    [PieceType.GOLD]: 81 + 9,
    [PieceType.BISHOP]: 81 + 14,
    [PieceType.ROOK]: 81 + 15,
    [PieceType.KING]: 81 + 8,
    [PieceType.PROM_PAWN]: 81 + 2,
    [PieceType.PROM_LANCE]: 81 + 3,
    [PieceType.PROM_KNIGHT]: 81 + 4,
    [PieceType.PROM_SILVER]: 81 + 5,
    [PieceType.HORSE]: 81 + 6,
    [PieceType.DRAGON]: 81 + 7
};
const usenHandReverseTable = {
    [81 + 10]: PieceType.PAWN,
    [81 + 11]: PieceType.LANCE,
    [81 + 12]: PieceType.KNIGHT,
    [81 + 13]: PieceType.SILVER,
    [81 + 9]: PieceType.GOLD,
    [81 + 14]: PieceType.BISHOP,
    [81 + 15]: PieceType.ROOK,
    [81 + 8]: PieceType.KING,
    [81 + 2]: PieceType.PROM_PAWN,
    [81 + 3]: PieceType.PROM_LANCE,
    [81 + 4]: PieceType.PROM_KNIGHT,
    [81 + 5]: PieceType.PROM_SILVER,
    [81 + 6]: PieceType.HORSE,
    [81 + 7]: PieceType.DRAGON
};
export var RecordMetadataKey = /*#__PURE__*/ function(RecordMetadataKey) {
    RecordMetadataKey["TITLE"] = "title";
    RecordMetadataKey["BLACK_NAME"] = "blackName";
    RecordMetadataKey["WHITE_NAME"] = "whiteName";
    RecordMetadataKey["SHITATE_NAME"] = "shitateName";
    RecordMetadataKey["UWATE_NAME"] = "uwateName";
    RecordMetadataKey["BLACK_SHORT_NAME"] = "blackShortName";
    RecordMetadataKey["WHITE_SHORT_NAME"] = "whiteShortName";
    RecordMetadataKey["START_DATETIME"] = "startDatetime";
    RecordMetadataKey["END_DATETIME"] = "endDatetime";
    RecordMetadataKey["DATE"] = "date";
    RecordMetadataKey["TOURNAMENT"] = "tournament";
    RecordMetadataKey["STRATEGY"] = "strategy";
    RecordMetadataKey["TIME_LIMIT"] = "timeLimit";
    RecordMetadataKey["BLACK_TIME_LIMIT"] = "blackTimeLimit";
    RecordMetadataKey["WHITE_TIME_LIMIT"] = "whiteTimeLimit";
    RecordMetadataKey["BYOYOMI"] = "byoyomi";
    RecordMetadataKey["TIME_SPENT"] = "timeSpent";
    RecordMetadataKey["MAX_MOVES"] = "maxMoves";
    RecordMetadataKey["JISHOGI"] = "jishogi";
    RecordMetadataKey["PLACE"] = "place";
    RecordMetadataKey["POSTED_ON"] = "postedOn";
    RecordMetadataKey["NOTE"] = "note";
    RecordMetadataKey["SCOREKEEPER"] = "scorekeeper";
    RecordMetadataKey["OPUS_NO"] = "opusNo";
    RecordMetadataKey["OPUS_NAME"] = "opusName";
    RecordMetadataKey["AUTHOR"] = "author";
    RecordMetadataKey["PUBLISHED_BY"] = "publishedBy";
    RecordMetadataKey["PUBLISHED_AT"] = "publishedAt";
    RecordMetadataKey["SOURCE"] = "source";
    RecordMetadataKey["LENGTH"] = "length";
    RecordMetadataKey["INTEGRITY"] = "integrity";
    RecordMetadataKey["CATEGORY"] = "category";
    RecordMetadataKey["AWARD"] = "award";
    return RecordMetadataKey;
}({});
export function getBlackPlayerName(metadata) {
    return metadata.getStandardMetadata("blackName") || metadata.getStandardMetadata("blackShortName") || metadata.getStandardMetadata("shitateName");
}
export function getWhitePlayerName(metadata) {
    return metadata.getStandardMetadata("whiteName") || metadata.getStandardMetadata("whiteShortName") || metadata.getStandardMetadata("uwateName");
}
export function getBlackPlayerNamePreferShort(metadata) {
    return metadata.getStandardMetadata("blackShortName") || metadata.getStandardMetadata("blackName") || metadata.getStandardMetadata("shitateName");
}
export function getWhitePlayerNamePreferShort(metadata) {
    return metadata.getStandardMetadata("whiteShortName") || metadata.getStandardMetadata("whiteName") || metadata.getStandardMetadata("uwateName");
}
export class RecordMetadata {
    standard = new Map();
    custom = new Map();
    get standardMetadataKeys() {
        return this.standard.keys();
    }
    getStandardMetadata(key) {
        return this.standard.get(key);
    }
    setStandardMetadata(key, value) {
        if (value) {
            this.standard.set(key, value);
        } else {
            this.standard.delete(key);
        }
    }
    get customMetadataKeys() {
        return this.custom.keys();
    }
    getCustomMetadata(key) {
        return this.custom.get(key);
    }
    setCustomMetadata(key, value) {
        if (value) {
            this.custom.set(key, value);
        } else {
            this.custom.delete(key);
        }
    }
}
function copyNodeMetadata(source, target) {
    target.comment = source.comment;
    target.bookmark = source.bookmark;
    target.customData = source.customData;
    target.setElapsedMs(source.elapsedMs);
}
class NodeImpl {
    ply;
    prev;
    branchIndex;
    activeBranch;
    nextColor;
    move;
    isCheck;
    displayText;
    sfen;
    next = null;
    branch = null;
    comment = "";
    customData;
    elapsedMs = 0;
    totalElapsedMs = 0;
    bookmark = "";
    constructor(ply, prev, branchIndex, activeBranch, nextColor, move, isCheck, displayText, sfen){
        this.ply = ply;
        this.prev = prev;
        this.branchIndex = branchIndex;
        this.activeBranch = activeBranch;
        this.nextColor = nextColor;
        this.move = move;
        this.isCheck = isCheck;
        this.displayText = displayText;
        this.sfen = sfen;
    }
    get timeText() {
        const elapsed = millisecondsToMSS(this.elapsedMs);
        const totalElapsed = millisecondsToHHMMSS(this.totalElapsedMs);
        return `${elapsed} / ${totalElapsed}`;
    }
    get hasBranch() {
        return !!this.prev && !!this.prev.next && !!this.prev.next.branch;
    }
    get isFirstBranch() {
        return !this.prev || this.prev.next === this;
    }
    get isLastMove() {
        if (!this.next) {
            return true;
        }
        for(let p = this.next; p; p = p.branch){
            if (p.move instanceof Move) {
                return false;
            }
        }
        return true;
    }
    updateTotalElapsedMs() {
        this.totalElapsedMs = this.elapsedMs;
        if (this.prev && this.prev.prev) {
            this.totalElapsedMs += this.prev.prev.totalElapsedMs;
        }
    }
    setElapsedMs(elapsedMs) {
        this.elapsedMs = elapsedMs;
        this.updateTotalElapsedMs();
        let p = this.next;
        const stack = [];
        while(p){
            p.updateTotalElapsedMs();
            if (p.branch) {
                stack.push(p.branch);
            }
            if (p.next) {
                p = p.next;
            } else {
                p = stack.pop() || null;
            }
        }
    }
    static newRootEntry(position) {
        return new NodeImpl(0, null, 0, true, position.color, specialMove(SpecialMoveType.START), false, "開始局面", position.sfen);
    }
}
export class Record {
    metadata;
    _initialPosition;
    _position;
    _first;
    _current;
    repetitionCounts = {};
    repetitionStart = {};
    onChangePosition = ()=>{};
    onClear = ()=>{};
    onAddNode = ()=>{};
    onRemoveNode = ()=>{};
    constructor(position){
        this.metadata = new RecordMetadata();
        this._initialPosition = position ? position.clone() : new Position();
        this._position = this.initialPosition.clone();
        this._first = NodeImpl.newRootEntry(this._initialPosition);
        this._current = this._first;
        this.incrementRepetition();
    }
    get initialPosition() {
        return this._initialPosition;
    }
    get position() {
        return this._position;
    }
    get first() {
        return this._first;
    }
    get current() {
        return this._current;
    }
    get moves() {
        const moves = this.movesBefore;
        for(let p = this._current.next; p; p = p.next){
            while(!p.activeBranch){
                p = p.branch;
            }
            moves.push(p);
        }
        return moves;
    }
    get movesBefore() {
        return this._movesBefore;
    }
    get _movesBefore() {
        const moves = new Array();
        moves.unshift(this._current);
        for(let p = this._current.prev; p; p = p.prev){
            moves.unshift(p);
        }
        return moves;
    }
    get length() {
        let len = this._current.ply;
        for(let p = this._current.next; p; p = p.next){
            while(!p.activeBranch){
                p = p.branch;
            }
            len = p.ply;
        }
        return len;
    }
    get branchBegin() {
        return this._current.prev ? this._current.prev.next : this._current;
    }
    clear(position) {
        this.metadata = new RecordMetadata();
        if (position) {
            this._initialPosition = position.clone();
        }
        this._position = this.initialPosition.clone();
        this._first = NodeImpl.newRootEntry(this._initialPosition);
        this._current = this._first;
        this.repetitionCounts = {};
        this.repetitionStart = {};
        this.incrementRepetition();
        this.onClear(this._initialPosition);
        this.onChangePosition();
    }
    goBack() {
        if (this._goBack()) {
            this.onChangePosition();
            return true;
        }
        return false;
    }
    _goBack() {
        if (this._current.prev) {
            if (this._current.move instanceof Move) {
                this.decrementRepetition();
                this._position.undoMove(this._current.move);
            }
            this._current = this._current.prev;
            return true;
        }
        return false;
    }
    goForward() {
        if (this._goForward()) {
            this.onChangePosition();
            return true;
        }
        return false;
    }
    _goForward() {
        if (this._current.next) {
            this._current = this._current.next;
            while(!this._current.activeBranch){
                this._current = this._current.branch;
            }
            if (this._current.move instanceof Move) {
                this._position.doMove(this._current.move, {
                    ignoreValidation: true
                });
                this.incrementRepetition();
            }
            return true;
        }
        return false;
    }
    goto(ply) {
        const orgPly = this._current.ply;
        this._goto(ply);
        if (orgPly !== this._current.ply) {
            this.onChangePosition();
        }
    }
    gotoNode(node) {
        const variation = [];
        let first = node;
        for(let p = node; p.prev; p = p.prev){
            variation.unshift(p);
            first = p.prev;
        }
        if (this.first !== first) {
            return false;
        }
        const orgNode = this._current;
        this._goto(0);
        for (const p of variation){
            this._goForward();
            this._switchBranchByIndex(p.branchIndex);
        }
        if (orgNode !== this._current) {
            this.onChangePosition();
        }
        return true;
    }
    _goto(ply) {
        while(ply < this._current.ply){
            if (!this._goBack()) {
                break;
            }
        }
        while(ply > this._current.ply){
            if (!this._goForward()) {
                break;
            }
        }
    }
    resetAllBranchSelection() {
        let confluence = this._current;
        for(let node = this._current; node.prev; node = node.prev){
            if (!node.isFirstBranch) {
                confluence = node.prev;
            }
        }
        this._forEach((node)=>{
            node.activeBranch = node.isFirstBranch;
        });
        if (this._current !== confluence) {
            while(this._current !== confluence){
                this._goBack();
            }
            this.onChangePosition();
        }
    }
    switchBranchByIndex(index) {
        if (this.current.branchIndex === index) {
            return true;
        }
        if (!this._switchBranchByIndex(index)) {
            return false;
        }
        this.onChangePosition();
        return true;
    }
    _switchBranchByIndex(index) {
        if (this.current.branchIndex === index) {
            return true;
        }
        if (!this._current.prev) {
            return false;
        }
        let ok = false;
        for(let p = this._current.prev.next; p; p = p.branch){
            if (p.branchIndex === index) {
                p.activeBranch = true;
                if (this._current.move instanceof Move) {
                    this.decrementRepetition();
                    this._position.undoMove(this._current.move);
                }
                this._current = p;
                if (this._current.move instanceof Move) {
                    this._position.doMove(this._current.move, {
                        ignoreValidation: true
                    });
                    this.incrementRepetition();
                }
                ok = true;
            } else {
                p.activeBranch = false;
            }
        }
        if (!ok) {
            this._current.activeBranch = true;
        }
        return ok;
    }
    append(move, opt) {
        if (this._append(move, opt)) {
            this.onChangePosition();
            return true;
        }
        return false;
    }
    _append(move, opt) {
        if (typeof move === "string") {
            move = specialMove(move);
        }
        const lastMove = this.current.move instanceof Move ? this.current.move : undefined;
        const displayText = move instanceof Move ? formatMove(this.position, move, {
            lastMove
        }) : formatSpecialMove(move, this.current.nextColor);
        let isCheck = false;
        if (move instanceof Move) {
            if (!this._position.doMove(move, opt)) {
                return false;
            }
            isCheck = this.position.checked;
        }
        if (this._current !== this.first && !(this._current.move instanceof Move)) {
            this._goBack();
        }
        if (move instanceof Move) {
            this.incrementRepetition(this._current.ply + 1);
        }
        if (!this._current.next) {
            this._current.next = new NodeImpl(this._current.ply + 1, this._current, 0, true, this.position.color, move, isCheck, displayText, this.position.sfen);
            this._current = this._current.next;
            this._current.setElapsedMs(0);
            this.onAddNode(this._current);
            return true;
        }
        let p;
        for(p = this._current.next; p; p = p.branch){
            p.activeBranch = false;
        }
        let lastBranch = this._current.next;
        for(p = this._current.next; p; p = p.branch){
            if (areSameMoves(move, p.move)) {
                this._current = p;
                this._current.activeBranch = true;
                return true;
            }
            lastBranch = p;
        }
        this._current = new NodeImpl(this._current.ply + 1, this._current, lastBranch.branchIndex + 1, true, this.position.color, move, isCheck, displayText, this.position.sfen);
        this._current.setElapsedMs(0);
        lastBranch.branch = this._current;
        this.onAddNode(this._current);
        return true;
    }
    swapWithNextBranch() {
        if (!this._current.branch) {
            return false;
        }
        return Record.swapWithPreviousBranch(this._current.branch);
    }
    swapWithPreviousBranch() {
        return Record.swapWithPreviousBranch(this._current);
    }
    static swapWithPreviousBranch(target) {
        const prev = target.prev;
        if (!prev || !prev.next || prev.next == target) {
            return false;
        }
        if (prev.next.branch === target) {
            const pair = prev.next;
            pair.branch = target.branch;
            target.branch = pair;
            prev.next = target;
            [target.branchIndex, pair.branchIndex] = [
                pair.branchIndex,
                target.branchIndex
            ];
            return true;
        }
        for(let p = prev.next; p.branch; p = p.branch){
            if (p.branch.branch === target) {
                const pair = p.branch;
                pair.branch = target.branch;
                target.branch = pair;
                p.branch = target;
                [target.branchIndex, pair.branchIndex] = [
                    pair.branchIndex,
                    target.branchIndex
                ];
                return true;
            }
        }
        return false;
    }
    removeCurrentMove() {
        const target = this._current;
        if (!this.goBack()) {
            return this.removeNextMove();
        }
        this.onRemoveSubTree(target);
        if (this._current.next === target) {
            this._current.next = target.branch;
        } else {
            for(let p = this._current.next; p; p = p.branch){
                if (p.branch === target) {
                    p.branch = target.branch;
                    break;
                }
            }
        }
        let branchIndex = 0;
        for(let p = this._current.next; p; p = p.branch){
            p.branchIndex = branchIndex;
            branchIndex += 1;
        }
        if (this._current.next) {
            this._current.next.activeBranch = true;
        }
        this.onChangePosition();
        return true;
    }
    removeNextMove() {
        if (this._current.next) {
            for(let p = this.current.next; p; p = p.branch){
                this.onRemoveSubTree(p);
            }
            this._current.next = null;
            return true;
        }
        return false;
    }
    onRemoveSubTree(root) {
        let p = root;
        while(p){
            if (p.next) {
                p = p.next;
                continue;
            }
            this.onRemoveNode(p);
            if (p === root) {
                return;
            }
            while(!p.branch){
                if (!p.prev) {
                    return;
                }
                p = p.prev;
                this.onRemoveNode(p);
                if (p === root) {
                    return;
                }
            }
            p = p.branch;
        }
    }
    merge(record) {
        if (this.initialPosition.sfen !== record.initialPosition.sfen) {
            return false;
        }
        const path = this.movesBefore;
        this._goto(0);
        this.mergeIntoCurrentPosition(record);
        for(let i = 1; i < path.length; i++){
            this._append(path[i].move, {
                ignoreValidation: true
            });
        }
        return true;
    }
    mergeIntoCurrentPosition(record, option) {
        const begin = this._current.ply;
        let errorPly = null;
        let successCount = 0;
        let skipCount = 0;
        record.forEach((node)=>{
            if (node.ply === 0) {
                return;
            }
            const ply = begin + node.ply - 1;
            if (errorPly !== null && ply > errorPly) {
                skipCount++;
                return;
            }
            this._goto(ply);
            if (!this._append(node.move, option)) {
                errorPly = ply;
                skipCount++;
                return;
            }
            errorPly = null;
            successCount++;
            if (node.elapsedMs && !this.current.elapsedMs) {
                this.current.setElapsedMs(node.elapsedMs);
            }
            if (node.comment && !this.current.comment) {
                this.current.comment = node.comment;
            }
            if (node.bookmark && !this.current.bookmark) {
                this.current.bookmark = node.bookmark;
            }
            if (node.customData && !this.current.customData) {
                this.current.customData = node.customData;
            }
        });
        this._goto(begin);
        return {
            successCount,
            skipCount
        };
    }
    jumpToBookmark(bookmark) {
        if (this._current.bookmark === bookmark) {
            return true;
        }
        const node = this.find((node)=>node.bookmark === bookmark);
        if (!node) {
            return false;
        }
        const route = [];
        for(let p = node; p; p = p.prev){
            route[p.ply] = p;
        }
        while(this._current !== route[this._current.ply]){
            this.goBack();
        }
        while(route.length > this._current.ply + 1){
            this.append(route[this._current.ply + 1].move);
        }
        this.onChangePosition();
        return true;
    }
    incrementRepetition(ply) {
        const sfen = this.position.sfen;
        if (this.repetitionCounts[sfen]) {
            this.repetitionCounts[sfen] += 1;
        } else {
            this.repetitionCounts[sfen] = 1;
            this.repetitionStart[sfen] = ply ?? this.current.ply;
        }
    }
    decrementRepetition() {
        const sfen = this.position.sfen;
        this.repetitionCounts[sfen] -= 1;
        if (this.repetitionCounts[sfen] === 0) {
            delete this.repetitionCounts[sfen];
            delete this.repetitionStart[sfen];
        }
    }
    get repetition() {
        return this.repetitionCounts[this.position.sfen] >= 4;
    }
    getRepetitionCount(position) {
        return this.repetitionCounts[position.sfen] || 0;
    }
    get perpetualCheck() {
        if (!this.repetition) {
            return null;
        }
        const sfen = this.position.sfen;
        const since = this.repetitionStart[sfen];
        let black = true;
        let white = true;
        let color = this.position.color;
        for(let p = this.current; p && p.ply >= since; p = p.prev){
            color = reverseColor(color);
            if (p.isCheck) {
                continue;
            }
            if (color === Color.BLACK) {
                black = false;
            } else {
                white = false;
            }
        }
        return black ? Color.BLACK : white ? Color.WHITE : null;
    }
    get usi() {
        return this.getUSI();
    }
    getUSI(opts) {
        const sfen = this.initialPosition.sfen;
        const useStartpos = opts?.startpos !== false && sfen === InitialPositionSFEN.STANDARD;
        const position = "position " + (useStartpos ? "startpos" : "sfen " + this.initialPosition.sfen);
        const moves = [];
        for(let p = this.first;; p = p.next){
            while(!p.activeBranch){
                p = p.branch;
            }
            if (p.move instanceof Move) {
                moves.push(p.move.usi);
            } else if (opts?.resign && p.move.type === SpecialMoveType.RESIGN) {
                moves.push("resign");
            } else if (opts?.repDraw && p.move.type === SpecialMoveType.REPETITION_DRAW) {
                moves.push("rep_draw");
            } else if (opts?.draw && p.move.type === SpecialMoveType.DRAW) {
                moves.push("draw");
            } else if (opts?.timeout && p.move.type === SpecialMoveType.TIMEOUT) {
                moves.push("timeout");
            } else if (opts?.break && p.move.type === SpecialMoveType.INTERRUPT) {
                moves.push("break");
            } else if (opts?.win && p.move.type === SpecialMoveType.ENTERING_OF_KING) {
                moves.push("win");
            }
            if (!p.next || !opts?.allMoves && p === this.current) {
                break;
            }
        }
        if (moves.length === 0) {
            return position;
        }
        return [
            position,
            "moves"
        ].concat(moves).join(" ");
    }
    get sfen() {
        return this.position.getSFEN(this._current.ply + 1);
    }
    get usen() {
        const sfen = this.initialPosition.sfen;
        let usen = sfen === InitialPositionSFEN.STANDARD ? "" : sfen.replace(/ 1$/, "").replace(/\//g, "_").replace(/ /g, ".").replace(/\+/g, "z");
        let moves = "0.";
        let special = "";
        let lastPly = 0;
        let bi = 0;
        let branchIndex = 0;
        this.forEach((node)=>{
            if (node.ply === 0) {
                return;
            }
            const move = node.move;
            if (lastPly + 1 !== node.ply) {
                usen += `~${moves}.${special}`;
                moves = `${node.ply - 1}.`;
                bi++;
            }
            if (this.current === node) {
                branchIndex = bi;
            }
            if (!(move instanceof Move)) {
                switch(move.type){
                    case SpecialMoveType.RESIGN:
                        special = "r";
                        break;
                    case SpecialMoveType.TIMEOUT:
                        special = "t";
                        break;
                    case SpecialMoveType.MAX_MOVES:
                    case SpecialMoveType.IMPASS:
                    case SpecialMoveType.DRAW:
                        special = "j";
                        break;
                    default:
                        special = "p";
                        break;
                }
                return;
            }
            const from = move.from instanceof Square ? (move.from.rank - 1) * 9 + (move.from.file - 1) : usenHandTable[move.from];
            const to = (move.to.rank - 1) * 9 + (move.to.file - 1);
            const m = (from * 81 + to) * 2 + (move.promote ? 1 : 0);
            moves += m.toString(36).padStart(3, "0");
            lastPly = node.ply;
        });
        usen += `~${moves}.${special}`;
        return [
            usen,
            branchIndex
        ];
    }
    get bookmarks() {
        const bookmarks = [];
        const existed = {};
        this.forEach((node)=>{
            if (node.bookmark && !existed[node.bookmark]) {
                bookmarks.push(node.bookmark);
                existed[node.bookmark] = true;
            }
        });
        return bookmarks;
    }
    forEach(handler) {
        this._forEach(handler);
    }
    _forEach(handler) {
        this.find((node)=>{
            handler(node);
            return false;
        });
    }
    find(handler) {
        let p = this._first;
        while(true){
            if (handler(p)) {
                return p;
            }
            if (p.next) {
                p = p.next;
                continue;
            }
            while(!p.branch){
                if (!p.prev) {
                    return null;
                }
                p = p.prev;
            }
            p = p.branch;
        }
    }
    getSubtree() {
        const subtree = new Record(this.position);
        for (const key of Object.values(RecordMetadataKey)){
            const value = this.metadata.getStandardMetadata(key);
            if (value) {
                subtree.metadata.setStandardMetadata(key, value);
            }
        }
        for (const key of this.metadata.customMetadataKeys){
            const value = this.metadata.getCustomMetadata(key);
            if (value) {
                subtree.metadata.setCustomMetadata(key, value);
            }
        }
        let p = this.current;
        copyNodeMetadata(p, subtree.current);
        if (!p.next) {
            return subtree;
        }
        p = p.next;
        while(true){
            subtree.append(p.move, {
                ignoreValidation: true
            });
            copyNodeMetadata(p, subtree.current);
            if (p.next) {
                p = p.next;
                continue;
            }
            while(!p.branch){
                if (!p.prev || p.prev === this.current) {
                    subtree.goto(0);
                    return subtree;
                }
                subtree.goBack();
                p = p.prev;
            }
            subtree.goBack();
            p = p.branch;
        }
    }
    on(event, handler) {
        switch(event){
            case "changePosition":
                this.onChangePosition = handler;
                break;
            case "clear":
                this.onClear = handler;
                break;
            case "addNode":
                this.onAddNode = handler;
                break;
            case "removeNode":
                this.onRemoveNode = handler;
                break;
        }
    }
    static newByUSI(data) {
        const positionStartpos = "position startpos";
        const startpos = "startpos";
        const prefixPositionStartpos = "position startpos ";
        const prefixPositionSFEN = "position sfen ";
        const prefixStartpos = "startpos ";
        const prefixSFEN = "sfen ";
        const prefixMoves = "moves ";
        if (data === positionStartpos || data === startpos) {
            return new Record();
        } else if (data.startsWith(prefixPositionStartpos)) {
            return Record.newByUSIFromMoves(data.slice(prefixPositionStartpos.length));
        } else if (data.startsWith(prefixPositionSFEN)) {
            return Record.newByUSIFromSFEN(data.slice(prefixPositionSFEN.length));
        } else if (data.startsWith(prefixStartpos)) {
            return Record.newByUSIFromMoves(data.slice(prefixStartpos.length));
        } else if (data.startsWith(prefixSFEN)) {
            return Record.newByUSIFromSFEN(data.slice(prefixSFEN.length));
        } else if (data.startsWith(prefixMoves)) {
            return Record.newByUSIFromMoves(data);
        } else {
            return new InvalidUSIError(data);
        }
    }
    static newByUSIFromSFEN(data) {
        const sections = data.split(" ");
        if (sections.length < 3) {
            return new InvalidUSIError(data);
        }
        const movesIndex = sections.length === 3 || sections[3] === "moves" ? 3 : 4;
        const position = Position.newBySFEN(sections.slice(0, movesIndex).join(" "));
        if (!position) {
            return new InvalidUSIError(data);
        }
        return Record.newByUSIFromMoves(sections.slice(movesIndex).join(" "), position);
    }
    static newByUSIFromMoves(data, position) {
        const record = new Record(position);
        if (data.length === 0) {
            return record;
        }
        const sections = data.split(" ");
        if (sections[0] !== "moves") {
            return new InvalidUSIError(data);
        }
        for(let i = 1; i < sections.length; i++){
            if (sections[i] === "resign") {
                record.append(SpecialMoveType.RESIGN);
                break;
            } else if (sections[i] === "rep_draw") {
                record.append(SpecialMoveType.REPETITION_DRAW);
                break;
            } else if (sections[i] === "draw") {
                record.append(SpecialMoveType.DRAW);
                break;
            } else if (sections[i] === "timeout") {
                record.append(SpecialMoveType.TIMEOUT);
                break;
            } else if (sections[i] === "break") {
                record.append(SpecialMoveType.INTERRUPT);
                break;
            } else if (sections[i] === "win") {
                record.append(SpecialMoveType.ENTERING_OF_KING);
                break;
            }
            const parsed = parseUSIMove(sections[i]);
            if (!parsed) {
                break;
            }
            let move = record.position.createMove(parsed.from, parsed.to);
            if (!move) {
                return new InvalidMoveError(sections[i]);
            }
            if (parsed.promote) {
                move = move.withPromote();
            }
            record.append(move, {
                ignoreValidation: true
            });
        }
        return record;
    }
    static newByUSEN(usen, branchIndex, ply) {
        const sections = usen.split("~");
        if (sections.length < 2) {
            return new Error("USEN must have at least 2 sections.");
        }
        const sfen = sections[0].replace(/_/g, "/").replace(/\./g, " ").replace(/z/g, "+");
        const position = sfen === "" ? new Position() : Position.newBySFEN(sfen + " 1");
        if (!position) {
            return new Error("Invalid SFEN in USEN.");
        }
        const record = new Record(position);
        let activeNode = record.first;
        for(let si = 1; si < sections.length; si++){
            const [n, moves, special] = sections[si].split(".");
            if (!/[0-9]+/.test(n)) {
                return new Error("Invalid USEN ply format.");
            }
            record.goto(parseInt(n));
            for(let i = 0; i < moves.length; i += 3){
                const m = parseInt(moves.slice(i, i + 3), 36);
                const f = Math.floor(m / 162);
                const from = f < 81 ? new Square(f % 9 + 1, Math.floor(f / 9) + 1) : usenHandReverseTable[f];
                const t = Math.floor(m % 162 / 2);
                const to = new Square(t % 9 + 1, Math.floor(t / 9) + 1);
                const promote = m % 2 === 1;
                const move = record.position.createMove(from, to);
                if (!move) {
                    return new Error("Invalid move in USEN.");
                }
                record.append(promote ? move.withPromote() : move, {
                    ignoreValidation: true
                });
                if (si - 1 === branchIndex && record.current.ply === ply) {
                    activeNode = record.current;
                }
            }
            if (special === "r") {
                record.append(specialMove(SpecialMoveType.RESIGN));
            } else if (special === "t") {
                record.append(specialMove(SpecialMoveType.TIMEOUT));
            } else if (special === "j") {
                record.append(specialMove(SpecialMoveType.IMPASS));
            } else if (special === "p") {
                record.append(specialMove(SpecialMoveType.INTERRUPT));
            }
            if (si - 1 === branchIndex && record.current.ply === ply) {
                activeNode = record.current;
            }
        }
        if (activeNode === record.first) {
            record.goto(0);
        } else {
            const route = [];
            for(let p = activeNode; p; p = p.prev){
                route[p.ply] = p;
            }
            while(record._current !== route[record._current.ply]){
                record.goBack();
            }
            while(route.length > record._current.ply + 1){
                record.append(route[record._current.ply + 1].move);
            }
        }
        return record;
    }
}
export function getNextColorFromUSI(usi) {
    const sections = usi.trim().split(" ");
    const baseColor = sections[1] === "startpos" || sections[3] === "b" ? Color.BLACK : Color.WHITE;
    const firstMoveIndex = sections[1] === "startpos" ? sections[2] === "moves" ? 3 : 2 : sections[6] === "moves" ? 7 : 6;
    return (sections.length - firstMoveIndex) % 2 === 0 ? baseColor : reverseColor(baseColor);
}
