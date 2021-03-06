import * as _ from 'lodash'

import { VBH, EnabledAABB } from '../vbh/vbh'
import { Entity } from './entity'
import { Contact, _Contact, Overlap } from './contact'
import { BodyType } from './enums'

interface BodyArgs {
    x?: number
    y?: number

    enabled?: boolean
}
interface SmallBodyArgs extends BodyArgs {
    isSensor?: boolean
    layer?: string
    layerGroup?: number
}
export interface RectArgs extends SmallBodyArgs {
    width: number
    height: number
}
export interface LineArgs extends SmallBodyArgs {
    size: number
    isHorizontal: boolean
    side?: string
}
export interface GridArgs extends BodyArgs {
    layer?: string
    layerGroup?: number
    tiles?: TileArgs
    width?: number
    height?: number
    tileSize?: number
}
type TileList = { x: number, y: number, shape: number, data?: any }[]
type TileGrid = { x: number, y: number, info: ({ shape: number, data?: any } | number)[][] }
export type TileArgs = TileList | TileGrid

let resetminx = false, resetmaxx = false, resetminy = false, resetmaxy = false

export abstract class Body implements EnabledAABB {

    type: BodyType

    _grid: Grid
    _entity: Entity

    _enabled: boolean

    _x: number
    _y: number

    // contacts with bodies belonging to top-entity with a higher level. Can be null
    _higherContacts: _Contact[]

    get entity(): Entity { return this._entity }
    set entity(val: Entity) { console.log("[ERROR] can't set entity") }
    get _topEntity(): Entity { return this._entity._topEntity }

    get enabled(): boolean { return this._enabled }
    set enabled(val: boolean) {
        if (val != this._enabled && !val) {
            // just clears every contacts
            this._enabledChangeContactFix () 
        }
        this._enabled = val
    }

    get x(): number { return this._x - this._topEntity.globalx + this._entity.globalx }
    get y(): number { return this._y - this._topEntity.globaly + this._entity.globaly }

    get globalx(): number { return this._x + this._topEntity.globalx }
    get globaly(): number { return this._y + this._topEntity.globaly }

    set x(val: number) {
        let x = val, topEntity = this._entity
        while (topEntity != this._topEntity) { x += topEntity._x; topEntity = topEntity._parent }
        this._topx = x
    }
    set y(val: number) {
        let y = val, topEntity = this._entity
        while (topEntity != this._topEntity) { y += topEntity._y; topEntity = topEntity._parent }
        this._topy = y
    }
    set _topx(val: number) {
        // factorized code for handling position changes.
        // when a body is moved you have to remove lost contacts and change the bounds of the topentity (minX, maxX, minY, maxY)
        // _testResetBounds calculates if this body was at one of the bounds
        // _clearContacts removes all contact TODO: remove only lost ones
        // _resetBounds checks the modified values in _testResetBounds and applies the changes
        this._testResetBounds()
        this._x = val
        this._clearContacts()
        this._resetBounds()
    }
    set _topy(val: number) {
        this._testResetBounds()
        this._y = val
        this._clearContacts()
        this._resetBounds()
    }
    set globalx(val: number) { this._topx = val - this._topEntity.globalx }
    set globaly(val: number) { this._topy = val - this._topEntity.globaly }

    get contacts(): Contact[] {
        return this._topEntity.contacts.filter(c => c.body == this)
    }
    get leftContact(): Contact {
        let leftContact = this._topEntity.leftContact
        return leftContact && leftContact.body == this && leftContact
    }
    get rightContact(): Contact {
        let rightContact = this._topEntity.rightContact
        return rightContact && rightContact.body == this && rightContact
    }
    get upContact(): Contact {
        let upContact = this._topEntity.upContact
        return upContact && upContact.body == this && upContact
    }
    get downContact(): Contact {
        let downContact = this._topEntity.downContact
        return downContact && downContact.body == this && downContact
    }

    abstract minX: number
    abstract minY: number
    abstract maxX: number
    abstract maxY: number

    constructor(entity: Entity, args?: BodyArgs) {
        if (args) {
            this._entity = entity

            this._x = args.x || 0
            this._y = args.y || 0
            this._enabled = args.enabled != null ? args.enabled : true
        }
    }

    localToGlobal(x: number | { x: number, y: number }, y?: number): { x: number, y: number } {
        if (typeof x !== "number") {
            y = x.y
            x = x.x
        }
        let topParent = this._entity
        while (topParent != this._topEntity) {
            x += topParent._x
            y += topParent._y
            topParent = topParent._parent
        }
        return {
            x: x + this._x + this._topEntity.globalx,
            y: y + this._y + this._topEntity.globaly
        }
    }
    globalToLocal(x: number | { x: number, y: number }, y?: number): { x: number, y: number } {
        if (typeof x !== "number") {
            y = x.y
            x = x.x
        }
        let topParent = this._entity
        while (topParent != this._topEntity) {
            x -= topParent._x
            y -= topParent._y
            topParent = topParent._parent
        }
        return {
            x: x - this._x - this._topEntity.globalx,
            y: y - this._y - this._topEntity.globaly
        }
    }

    _clearContacts() {
        let remove: number[]
        for (let i = 0, len = this._topEntity._lowers.length; i < len; i++) {
            let lower = this._topEntity._lowers[i]
            if (lower.body as Body == this) {
                if (remove) remove.push(i)
                else remove = [i]
                let j = lower.otherBody._higherContacts.indexOf(lower)
                lower.otherBody._higherContacts.splice(j, 1)
            }
        }
        if (remove) this._topEntity._removeLowers(remove)

        if (this._higherContacts) {
            let toremove = []

            for (let higher of this._higherContacts) {
                let ind = higher.body._topEntity._lowers.indexOf(higher)
                higher.body._topEntity._lowers.splice(ind, 1)
                if (higher.body._entity._listener && higher.body._entity._listener.contactEnd) { 
                    higher.body._entity._listener.contactEnd(
                        higher.body, higher.otherBody, 
                        higher.side == 0 ? "right" : (higher.side == 1 ? "left" : (higher.side == 2 ? "up" : "down"))
                    )
                }
            }
            this._higherContacts = []
        }
    }

    _testResetBounds() {
        resetminx = this._topEntity._minX == this.minX
        resetmaxx = this._topEntity._maxX == this.maxX
        resetminy = this._topEntity._minY == this.minY
        resetmaxy = this._topEntity._maxY == this.maxY
    }
    _resetBounds() {
        let top = this._topEntity
        if (resetminx) { top._resetMinx() }
        if (resetmaxx) { top._resetMaxx() }
        if (resetminy) { top._resetMiny() }
        if (resetmaxy) { top._resetMaxy() }

        if (top._allBodies) {
            top._allBodies.updateAABB(this)
        } else if (!(top.bodies instanceof SmallBody)) {
            (top._bodies as VBH<Body>).updateAABB(this)
        }
    }

    _enabledChangeContactFix() {
        let topEntity = this._topEntity,
            remove: number[]
        for (let i = 0, len = topEntity._lowers.length; i < len; i++) {
            let lower = topEntity._lowers[i]
            if (lower.body == this as any) {
                let ind = lower.otherBody._higherContacts.indexOf(lower)
                lower.otherBody._higherContacts.splice(ind, 1)
                remove.push(i)
            }
        }
        if (remove) topEntity._removeLowers(remove)

        if (this._higherContacts) {
            for(let i = 0, len = this._higherContacts.length; i < len; i++) {
                let higher = this._higherContacts[i]
                let ind = higher.body._topEntity._lowers.indexOf(higher)
                higher.body._topEntity._lowers.splice(ind, 1)
                if (higher.body._topEntity._listener && higher.body._topEntity._listener.contactEnd) {
                    higher.body._topEntity._listener.contactEnd(
                        higher.body, higher.otherBody, 
                        higher.side == 0 ? "right" : (higher.side == 1 ? "left" : (higher.side == 2 ? "up" : "down"))
                    )
                }
            }
            this._higherContacts = null
        }
    }

    destroy() {
        this._entity.removeBody(this)
    }
}

export abstract class SmallBody extends Body {

    _isSensor: boolean
    _layer: number
    _layerGroup: number
    
    get isSensor(): boolean { return this._isSensor }
    get layer(): string { return this._topEntity._world._layerNames[this._layer] }
    get layerGroup(): number { return this._layerGroup }

    set isSensor(val: boolean) {
        if (val != this._isSensor) {
            this._isSensor = val
            if (val) this._isSensorChangeContactFix()
        }
    }
    set layer(val: string) {
        let l = (val && this._entity._world._getLayer(val)) || 0
        if (l != this._layer) {
            this._layer = l
            this._layerChangeContactFix()
        }
    }
    set layerGroup(val: number) {
        val = val || 0
        if (val != this._layerGroup) {
            this._layerGroup = val
            this._layerChangeContactFix()
        }
    }

    abstract _width: number
    abstract _height: number

    abstract _leftCollide: boolean
    abstract _rightCollide: boolean
    abstract _upCollide: boolean
    abstract _downCollide: boolean

    constructor(entity: Entity, args?: SmallBodyArgs) {
        super(entity, args)

        if (args) {
            this._isSensor = args.isSensor || false
            this._layer = args.layer ? this._entity._world._getLayer(args.layer) : 0
            this._layerGroup = args.layerGroup || 0
        }
    }

    _layerChangeContactFix() {
        let topEntity = this._topEntity,
            remove: number[]
        for (let i = 0, len = topEntity._lowers.length; i < len; i++) {
            let lower = topEntity._lowers[i]
            if (lower.body == this as any) {
                let removed: boolean
                switch(this._entity._world._getLayerRule(lower.body._layer, lower.otherBody._layer)) {
                    case 0x0: removed = true; break
                    case 0x1: removed = lower.body._layerGroup == lower.otherBody._layerGroup; break
                    case 0x2: removed = lower.body._layerGroup != lower.otherBody._layerGroup; break
                    default: removed = false
                }
                if (removed) {
                    let ind = lower.otherBody._higherContacts.indexOf(lower)
                    lower.otherBody._higherContacts.splice(ind, 1)
                    remove.push(i)
                }
            }
        }
        if (remove) topEntity._removeLowers(remove)

        if (this._higherContacts) {
            for(let i = 0, len = this._higherContacts.length; i < len; i++) {
                let higher = this._higherContacts[i]
                let removed: boolean
                switch(this._entity._world._getLayerRule(higher.body._layer, higher.otherBody._layer)) {
                    case 0x0: removed = true; break
                    case 0x1: removed = higher.body._layerGroup == higher.otherBody._layerGroup; break
                    case 0x2: removed = higher.body._layerGroup != higher.otherBody._layerGroup; break
                    default: removed = false
                }
                if (removed) {
                    let ind = higher.body._topEntity._lowers.indexOf(higher)
                    higher.body._topEntity._lowers.splice(ind, 1)
                    if (higher.body._topEntity._listener && higher.body._topEntity._listener.contactEnd) {
                        higher.body._topEntity._listener.contactEnd(
                            higher.body, higher.otherBody, 
                            higher.side == 0 ? "right" : (higher.side == 1 ? "left" : (higher.side == 2 ? "up" : "down"))
                        )
                    }
                }
            }
            this._higherContacts = null
        }
    }
    _isSensorChangeContactFix() {
        this._enabledChangeContactFix()
    }
}

export class Rect extends SmallBody {

    type = BodyType.RECT

    _width: number
    _height: number

    get width(): number { return this._width }
    get height(): number { return this._height }

    set width(val: number) {
        this._testResetBounds()
        this._width = val
        this._resetBounds()
        this._clearContacts()
    }
    set height(val: number) {
        this._testResetBounds()
        this._height = val
        this._resetBounds()
        this._clearContacts()
    }

    get minX(): number { return this._x - this._width / 2 }
    get maxX(): number { return this._x + this._width / 2 }
    get minY(): number { return this._y - this._height / 2 }
    get maxY(): number { return this._y + this._height / 2 }

    get _leftCollide(): boolean { return true }
    get _rightCollide(): boolean { return true }
    get _upCollide(): boolean { return true }
    get _downCollide(): boolean { return true }

    constructor(entity: Entity, args: RectArgs) {
        super(entity, args)

        if (args) {
            this._width = args.width
            this._height = args.height
        }
    }
}

export class Line extends SmallBody {

    type = BodyType.LINE

    _size: number

    _isHorizontal: boolean

    _oneway: number // 0: no, 1: up/right, 2: down/left

    get size(): number { return this._size }
    set size(val: number) {
        // same as positionning
        this._testResetBounds()
        this._size = val
        this._resetBounds()
        this._clearContacts()
    }

    get isHorizontal(): boolean { return this._isHorizontal }
    get isVertical(): boolean { return !this._isHorizontal }
    set isHorizontal(val: boolean) { console.log("[ERROR] Can't set Line.isHorizontal") }
    set isVertical(val: boolean) { console.log("[ERROR] Can't set Line.isVertical") }

    get side(): string {
        return this._oneway == 0 ? "all" :
            (this._isHorizontal ? (this._oneway == 1 ? "up" : "down") : (this._oneway == 1 ? "right" : "left"))
    }
    set side(val: string) {
        if (this.isHorizontal) {
            if (!val || val == "all") this._oneway = 0
            else if (val == "down") this._oneway = 2
            else if (val == "up") this._oneway = 1
        } else {
            if (!val || val == "all") this._oneway = 0
            else if (val == "right") this._oneway = 1
            else if (val == "left") this._oneway = 2
        }
    }

    get minX(): number { return this._x - (this._isHorizontal && this._size / 2) }
    get maxX(): number { return this._x + (this._isHorizontal && this._size / 2) }
    get minY(): number { return this._y - (!this._isHorizontal && this._size / 2) }
    get maxY(): number { return this._y + (!this._isHorizontal && this._size / 2) }

    get _width(): number { return this._isHorizontal ? this._size : 0 }
    get _height(): number { return this._isHorizontal ? 0 : this._size }
    set _width(val: number) { this._size = val }
    set _height(val: number) { this._size = val }

    get _leftCollide(): boolean { return this._oneway == 0 || !this._isHorizontal && this._oneway == 2 }
    get _rightCollide(): boolean { return this._oneway == 0 || !this._isHorizontal && this._oneway == 1 }
    get _upCollide(): boolean { return this._oneway == 0 || this._isHorizontal && this._oneway == 1 }
    get _downCollide(): boolean { return this._oneway == 0 || this._isHorizontal && this._oneway == 2 }

    constructor(entity: Entity, args: LineArgs) {
        super(entity, args)

        if (args) {
            this._size = args.size
            this._isHorizontal = args.isHorizontal
            if (args.side) {
                this.side = args.side
            } else {
                this._oneway = 0
            }
        }
    }
}

const subGridThreshold = 105
const subGridSize = 120

// The IDs of every cell types. If this is modified, make sure to
// update every references to cell IDs
export const EMPTY = 0
export const BLOCK_TILE = 1
export const UP_ONEWAY = 4
export const DOWN_ONEWAY = 2
export const LEFT_ONEWAY = 3
export const RIGHT_ONEWAY = 5

export class Grid extends Body {

    type = BodyType.GRID

    _layer: number
    _layerGroup: number

    _tileSize: number
    _gridSize: number

    // represents the bottom left corner of the most bottom left sub grid in this grid's space
    _xdownLeft: number
    _ydownLeft: number
    _subGrids: SubGrid | SubGrid[][]

    _width: number
    _height: number

    // these are used during the modification of the bodies of the grid: 
    // _newBodies represents the bodies that will be added
    // _oldBodies represents the bodies that will be removed
    // _updateBodies represents the bodies who were already on the entity whose shape changed
    _newBodies: Body[]
    _oldBodies: Body[]
    _updatedBodies: Body[]

    get minX(): number { console.log('Grid.minx not implemented'); return 0 }
    get maxX(): number { console.log('Grid.maxx not implemented'); return 0 }
    get minY(): number { console.log('Grid.miny not implemented'); return 0 }
    get maxY(): number { console.log('Grid.maxy not implemented'); return 0 }

    get tileSize(): number { return this._tileSize }
    set tileSize(val: number) { console.log("[ERROR] can't set Grid.tileSize") }

    constructor(entity: Entity, args: GridArgs) {
        super(entity, args)

        this._tileSize = args.tileSize || 1
        this._gridSize = subGridSize

        this._layer = args.layer ? entity._world._layerIds[args.layer] : 0
        this._layerGroup = args.layerGroup || 0

        // GET MIN AND MAX
        let minx, maxx, miny, maxy
        if (args.tiles != null) {
            if ((args.tiles as TileList).length != null) {
                minx = args.tiles[0].x
                miny = args.tiles[0].y
                maxx = args.tiles[0].x
                maxy = args.tiles[0].y

                for (let tile of args.tiles as any[]) {
                    minx = Math.min(minx, tile.x)
                    miny = Math.min(miny, tile.y)
                    maxx = Math.max(maxx, tile.x)
                    maxy = Math.max(maxy, tile.y)
                }
            } else {
                let t: TileGrid = args.tiles as TileGrid
                minx = t.x
                miny = t.y
                maxx = t.info.length + t.x
                maxy = t.info[0].length + t.y
            }
        } else {
            args.width = args.width || (this._gridSize - 15)
            args.height = args.height || (this._gridSize - 15)
            minx = -Math.floor(args.width / 2)
            maxx = minx + args.width
            miny = -Math.floor(args.height / 2)
            maxy = miny + args.height
        }

        // INIT EMPTY GRID
        if (maxx - minx > subGridThreshold || maxy - miny > subGridThreshold) {
            minx -= 10
            miny -= 10
            maxx += 10
            maxy += 10

            let w = Math.ceil((maxx - minx) / this._gridSize), h = Math.ceil((maxy - miny) / this._gridSize)

            this._subGrids = new Array(w)
            for (let i = 0; i < w; i++) {
                this._subGrids[i] = new Array(h)
                for (let j = 0; j < h; j++) {
                    this._subGrids[i][j] = new SubGrid(this._gridSize)
                }
            }

            this._xdownLeft = minx
            this._ydownLeft = miny
            this._width = w
            this._height = h
        } else {
            this._subGrids = new SubGrid(this._gridSize)
            this._xdownLeft = Math.floor((maxx - subGridThreshold) / 2)
            this._ydownLeft = Math.floor((maxy - subGridThreshold) / 2)
            this._width = 1
            this._height = 1
        }

        if (args.tiles != null) {
            if ((args.tiles as TileList).length != null) {
                let len = (args.tiles as TileList).length
                for (let t of args.tiles as TileList) {
                    this._setTile(
                        t.x - this._xdownLeft,
                        t.y - this._ydownLeft,
                        t.shape,
                        t.data
                    )
                }
            } else {
                this._setTiles(
                    (args.tiles as TileGrid).x - this._xdownLeft,
                    (args.tiles as TileGrid).y - this._ydownLeft,
                    (args.tiles as TileGrid).info.length,
                    (args.tiles as TileGrid).info[0].length,
                    (x, y) => (args.tiles as TileGrid).info[x - (args.tiles as TileGrid).x][y - (args.tiles as TileGrid).y]
                )
            }
        }
    }


    globalToBlock(x: number, y: number): { x: number, y: number } {
        return { 
            x: Math.floor(x - this.globalx), 
            y: Math.floor(y - this.globaly) 
        }
    }

    getBlock(x: number, y: number): { shape: number, data: any } {
        x -= this._xdownLeft
        y -= this._ydownLeft
        let subgrid: SubGrid

        if (this._subGrids instanceof SubGrid) {
            if (x >= 0 && y >= 0 && x < this._gridSize && y < this._gridSize) {
                subgrid = this._subGrids
            } else {
                return { shape: 0, data: null }
            }
        } else {
            let gridx = Math.floor(x / this._gridSize), gridy = Math.floor(y / this._gridSize)
            if (gridx >= 0 && gridy >= 0 && gridx < this._width && gridy < this._height) {
                subgrid = this._subGrids[gridx][gridy]
                if (!subgrid) {
                    return { shape: 0, data: null }
                }
                x -= gridx * this._gridSize
                y -= gridy * this._gridSize
            } else {
                return { shape: 0, data: null }
            }
        }

        return { shape: subgrid.tiles[x][y].shape, data: subgrid.tiles[x][y].data }
    }
    setBlock(x: number, y: number, shape: number, data) {
        this._expandGrid(x - this._xdownLeft, y - this._ydownLeft, x - this._xdownLeft, y - this._ydownLeft)

        x -= this._xdownLeft
        y -= this._ydownLeft

        this._setTile(x, y, shape, data)
    }

    clearBlock(x: number, y: number) {
        x -= this._xdownLeft
        y -= this._ydownLeft

        if (x >= 0 && y >= 0 && x < this._gridSize * this._width && y < this._gridSize * this._height) {
            this._setTile(x, y, 0, null)
        }
    }

    setBlocks(args: TileArgs) {
        let minx, maxx, miny, maxy,
            list = (args as TileList).length != null
        if (list) {
            let t = args as TileList
            if (!t.length) {
                return
            }
            minx = t[0].x
            miny = t[0].y
            maxx = t[0].x
            maxy = t[0].y

            for (let tile of t as any[]) {
                minx = Math.min(minx, tile.x)
                miny = Math.min(miny, tile.y)
                maxx = Math.max(maxx, tile.x)
                maxy = Math.max(maxy, tile.y)
            }
        } else {
            let t = args as TileGrid
            minx = t.x
            miny = t.y
            maxx = t.info.length + t.x
            maxy = t.info[0].length + t.y
        }

        minx -= this._xdownLeft
        maxx -= this._xdownLeft
        miny -= this._ydownLeft
        maxy -= this._ydownLeft

        this._expandGrid(minx, maxx, miny, maxy)

        if (list) {
            for (let t of args as TileList) {
                this._setTile(t.x - this._xdownLeft, t.y - this._ydownLeft, t.shape, t.data)
            }
        } else {
            this._setTiles(
                minx, miny,
                (args as any).info.length, (args as TileGrid).info[0].length,
                (x, y) => {
                    return (args as TileGrid).info[x - (args as any).x][y - (args as any).y]
                }
            )
        }
    }
    clearBlocks(args: { x: number, y: number, width: number, height: number } | { x: number, y: number }[]) {
        this._clearTiles(args, { shape: 0, data: null })
    }
    forBlocks(x: number, y: number, width: number, height: number, lambda: (x: number, y: number, shape: number, data) => ({ shape: number, data?} | number)) {
        this._expandGrid(x - this._xdownLeft, y - this._ydownLeft, x + width - this._xdownLeft, y + height - this._ydownLeft)

        this._setTiles(
            x - this._xdownLeft, y - this._ydownLeft,
            width, height, (xx, yy, shape, data) => lambda(xx, yy, shape, data)
        )
    }

    getBlockShape(x: number, y: number): number {
        return this.getBlock(x, y).shape
    }
    setBlockShape(x: number, y: number, shape: number) {
        this._expandGrid(x - this._xdownLeft, y - this._ydownLeft, x - this._xdownLeft, y - this._ydownLeft)

        x -= this._xdownLeft
        y -= this._ydownLeft

        this._setTile(x, y, shape)
    }
    clearBlockShape(x: number, y: number) {
        x -= this._xdownLeft
        y -= this._ydownLeft
        if (x >= 0 && y >= 0 && x < this._width * this._gridSize && y < this._height * this._gridSize) {
            this._setTile(x, y, 0)
        }
    }

    clearBlockShapes(args: { x: number, y: number }[] | { x: number, y: number, width: number, height: number }) {
        this._clearTiles(args, 0)
    }
    _clearTiles(args: { x: number, y: number }[] | { x: number, y: number, width: number, height: number }, zero: number | { shape: number, data?}) {
        if ((args as any).length != null) {
            if (typeof zero === "number") {
                for (let t of args as any[]) {
                    this.clearBlockShape(t.x, t.y)
                }
            } else {
                for (let t of args as any[]) {
                    this.clearBlock(t.x, t.y)
                }
            }
        } else {
            let x = Math.max(0, (args as any).x - this._xdownLeft),
                y = Math.max(0, (args as any).y - this._ydownLeft);
            (args as any).width = Math.min(this._width * this._gridSize, (args as any).x + (args as any).width) - x - this._xdownLeft;
            (args as any).height = Math.min(this._height * this._gridSize, (args as any).y + (args as any).height) - y - this._ydownLeft;

            if ((args as any).width > 0 && (args as any).height > 0) {
                this._setTiles(x, y, (args as any).width, (args as any).height, (x, y) => zero)
            }
        }
    }

    _horizontalBodyMerge(subgrid: SubGrid, tile: Tile, oldBody: SmallBody, x: number, y: number, xoffset: number, yoffset: number) {
        if (tile.shape == 1 || tile.shape == 2 || tile.shape == 4) {
            let body: SmallBody

            if (x < this._gridSize - 1) {
                let rightTile = subgrid.tiles[x + 1][y],
                    rightBody = rightTile.body

                if (rightBody && rightTile.shape == tile.shape
                    && rightTile.layer == tile.layer && rightTile.layerGroup == tile.layerGroup && (rightBody._height == 1 || tile.shape != 1)) {
                    rightBody._width += 1
                    rightBody._x -= 0.5
                    tile.body = rightBody
                    body = rightBody

                    let i = this._newBodies.indexOf(oldBody)
                    if (i >= 0) this._newBodies.splice(i, 1)
                    else this._oldBodies.push(oldBody)
                }
            }

            if (x > 0) {
                let leftTile = subgrid.tiles[x - 1][y],
                    leftBody = leftTile.body

                if (leftBody && leftTile.shape == tile.shape
                    && leftTile.layer == tile.layer && leftTile.layerGroup == tile.layerGroup && (leftBody._height == 1 || tile.shape != 1)) {
                    if (body) {
                        let i = this._newBodies.indexOf(leftBody)
                        if (i >= 0) this._newBodies.splice(i, 1)
                        else this._oldBodies.push(leftBody)

                        body._width += leftBody._width
                        body._x -= leftBody._width / 2

                        for (let i = leftBody._x - xoffset - leftBody._width / 2; i < x; i++) {
                            subgrid.tiles[i][y].body = body
                        }
                    } else {
                        leftBody._width += 1
                        leftBody._x += 0.5
                        tile.body = leftBody

                        let i = this._newBodies.indexOf(oldBody)
                        if (i >= 0) this._newBodies.splice(i, 1)
                        else this._oldBodies.push(oldBody)
                    }
                }
            }
        }
    }
    _verticalBodyMerge(subgrid: SubGrid, tile: Tile, oldBody: SmallBody, x: number, y: number, xoffset: number, yoffset: number) {
        if (tile.shape == 1 || tile.shape == 3 || tile.shape == 5) {
            let body: SmallBody

            if (y < this._gridSize - 1) {
                let upTile = subgrid.tiles[x][y + 1],
                    upBody = upTile.body

                if (upBody && upTile.shape == tile.shape
                    && upTile.layer == tile.layer && upTile.layerGroup == tile.layerGroup && (upBody._width == 1 || tile.shape != 1)) {
                    upBody._height += 1
                    upBody._y -= 0.5
                    tile.body = upBody
                    body = upBody

                    let i = this._newBodies.indexOf(oldBody)
                    if (i >= 0) this._newBodies.splice(i, 1)
                    else this._oldBodies.push(oldBody)
                }
            }

            if (x > 0) {
                let downTile = subgrid.tiles[x][y - 1],
                    downBody = downTile.body

                if (downBody && downTile.shape == tile.shape
                    && downTile.layer == tile.layer && downTile.layerGroup == tile.layerGroup && (downBody._width == 1 || tile.shape != 1)) {
                    if (body) {
                        let i = this._newBodies.indexOf(downBody)
                        if (i >= 0) this._newBodies.splice(i, 1)
                        else this._oldBodies.push(downBody)

                        body._height += downBody._height
                        body._y -= downBody._height / 2

                        for (let i = downBody._y - yoffset - downBody._height / 2; i < y; i++) {
                            subgrid.tiles[x][i].body = body
                        }
                    } else {
                        downBody._height += 1
                        downBody._y += 0.5
                        tile.body = downBody

                        let i = this._newBodies.indexOf(oldBody)
                        if (i >= 0) this._newBodies.splice(i, 1)
                        else this._oldBodies.push(oldBody)
                    }
                }
            }
        }
    }

    _removeBody(subgrid: SubGrid, tile: Tile, x: number, y: number, xoffset: number, yoffset: number) {
        let oldBody = tile.body

        if (oldBody) {
            if (oldBody._width <= 1) {
                if (oldBody._height <= 1) {
                    // one block body
                    let i = this._newBodies.indexOf(oldBody)
                    if (i >= 0) this._newBodies.splice(i, 1)
                    else this._oldBodies.push(oldBody)
                } else if (y + yoffset == oldBody._y - oldBody._height / 2) {
                    // block at the bottom of the body
                    oldBody._height -= 1
                    oldBody._y += 0.5

                    if (oldBody._height == 1) this._horizontalBodyMerge(subgrid, subgrid.tiles[x][y + 1], oldBody, x, y + 1, xoffset, yoffset)
                    this._updatedBodies.push(oldBody)
                } else if (y + yoffset == oldBody._y + oldBody._height / 2 - 1) {
                    // block at the top of the body
                    oldBody._height -= 1
                    oldBody._y -= 0.5

                    if (oldBody._height == 1) this._horizontalBodyMerge(subgrid, subgrid.tiles[x][y - 1], oldBody, x, y - 1, xoffset, yoffset)
                    this._updatedBodies.push(oldBody)
                } else {
                    // block at the middle of the body
                    let newBody: SmallBody
                    if (tile.shape == 1) {
                        // remove block shaped block
                        newBody = new Rect(null, null)

                        newBody._height = y + yoffset - oldBody._y + oldBody._height / 2
                        newBody._width = 1
                        newBody._y = y - newBody._height / 2 + yoffset
                        newBody._x = x + 0.5 + xoffset

                        oldBody._height -= newBody._height + 1
                        oldBody._y += (newBody._height + 1) / 2
                    } else {
                        // remove line from body, splits in half
                        newBody = new Line(null, null);

                        (newBody as Line)._size = y + yoffset - oldBody._y + (oldBody as Line)._size / 2;
                        (newBody as Line)._isHorizontal = false;
                        (newBody as Line)._y = y - (newBody as Line)._size / 2 + yoffset;
                        if (tile.shape == 3) {
                            (newBody as Line)._oneway = 2;
                            (newBody as Line)._x = x + xoffset;
                        } else {
                            (newBody as Line)._oneway = 1;
                            (newBody as Line)._x = x + xoffset + 1;
                        }

                        (oldBody as Line)._size -= (newBody as Line)._size + 1;
                        (oldBody as Line)._y += ((newBody as Line)._size + 1) / 2;
                    }

                    newBody._entity = this._entity
                    newBody._enabled = true
                    newBody._layer = oldBody._layer
                    newBody._layerGroup = oldBody._layerGroup
                    newBody._grid = this
                    newBody._isSensor = false
                    this._newBodies.push(newBody)
                    this._updatedBodies.push(oldBody)

                    for (let i = newBody._y - newBody._height / 2 - yoffset; i < newBody._y + newBody._height / 2 - yoffset; i++) {
                        subgrid.tiles[x][i].body = newBody
                    }

                    // when splitting, the two new bodies can be a 1 by 1 block next to similar blocks so we want to merge these
                    // together
                    if (newBody._height == 1) this._horizontalBodyMerge(subgrid, subgrid.tiles[x][y - 1], newBody, x, y - 1, xoffset, yoffset)
                    if (oldBody._height == 1) this._horizontalBodyMerge(subgrid, subgrid.tiles[x][y + 1], oldBody, x, y + 1, xoffset, yoffset)
                }
            } else {
                if (x + xoffset == oldBody._x - oldBody._width / 2) {
                    // block at the left of the body
                    oldBody._width -= 1
                    oldBody._x += 0.5

                    if (oldBody._width == 1) this._verticalBodyMerge(subgrid, subgrid.tiles[x + 1][y], oldBody, x + 1, y, xoffset, yoffset)
                    this._updatedBodies.push(oldBody)
                } else if (x + xoffset == oldBody._x + oldBody._width / 2 - 1) {
                    // block at the right of the body
                    oldBody._width -= 1
                    oldBody._x -= 0.5

                    if (oldBody._height == 1) this._verticalBodyMerge(subgrid, subgrid.tiles[x - 1][y], oldBody, x - 1, y, xoffset, yoffset)
                    this._updatedBodies.push(oldBody)
                } else {
                    // block at the middle of a horizontal body, splitting occurs
                    let newBody: SmallBody
                    if (tile.shape == 1) {
                        newBody = new Rect(null, null)

                        newBody._width = x + xoffset - oldBody._x + oldBody._width / 2
                        newBody._height = 1
                        newBody._x = x - newBody._width / 2 + xoffset
                        newBody._y = y + 0.5 + yoffset

                        oldBody._width -= newBody._width + 1
                        oldBody._x += (newBody._width + 1) / 2
                    } else {
                        newBody = new Line(null, null);

                        (newBody as Line)._size = x + xoffset - oldBody._x + (oldBody as Line)._size / 2;
                        (newBody as Line)._isHorizontal = true;
                        newBody._x = x - (newBody as Line)._size / 2 + xoffset

                        if (tile.shape == 2) {
                            (newBody as Line)._oneway = 2;
                            newBody._y = y + yoffset;
                        } else {
                            (newBody as Line)._oneway = 1;
                            newBody._y = y + yoffset + 1;
                        }

                        (oldBody as Line)._size -= (newBody as Line)._size + 1
                        oldBody._x += (newBody._width + 1) / 2
                    }

                    newBody._entity = this._entity
                    newBody._enabled = true
                    newBody._layer = oldBody._layer
                    newBody._layerGroup = oldBody._layerGroup
                    newBody._grid = this
                    newBody._isSensor = false
                    this._newBodies.push(newBody)
                    if (this._newBodies.indexOf(oldBody) < 0) this._updatedBodies.push(oldBody)

                    for (let i = newBody._x - newBody._width / 2 - xoffset; i < newBody._x + newBody._width / 2 - xoffset; i++) {
                        subgrid.tiles[i][y].body = newBody
                    }

                    // when splitting, the two new bodies can be a 1 by 1 block next to similar blocks so we want to merge these
                    // together
                    if (newBody._width == 1) this._verticalBodyMerge(subgrid, subgrid.tiles[x - 1][y], newBody, x - 1, y, xoffset, yoffset)
                    if (oldBody._width == 1) this._verticalBodyMerge(subgrid, subgrid.tiles[x + 1][y], oldBody, x + 1, y, xoffset, yoffset)
                }
            }
        }
        tile.body = null
    }

    _updateTileBody(subgrid: SubGrid, tile: Tile, x: number, y: number, xoffset: number, yoffset: number, shape: number, layer: number, layerGroup: number) {
        // REMOVE CURRENTLY PRESENT BODY
        this._removeBody(subgrid, tile, x, y, xoffset, yoffset)

        // TRY TO EXTEND EXISTING ADJACENT BODIES
        let left = x > 0 && subgrid.tiles[x - 1][y],
            right = x < this._gridSize - 1 && subgrid.tiles[x + 1][y],
            up = y < this._gridSize - 1 && subgrid.tiles[x][y + 1],
            down = y > 0 && subgrid.tiles[x][y - 1]

        if (shape > 1 || shape == 1
            && ((x == 0 || !left || left.shape != 1 || left.layer != layer || left.layerGroup != layerGroup)
                || (x == this._gridSize - 1 || !right || right.shape != 1 || right.layer != layer || left.layerGroup != layerGroup)
                || (y == 0 || !down || down.shape != 1 || down.layer != layer || down.layerGroup != layerGroup)
                || (y == this._gridSize - 1 || !up || up.shape != 1 || up.layer != layer || up.layerGroup != layerGroup))) {

            let fail = false

            if (shape == 1 || shape == 2 || shape == 4) {
                let body: SmallBody

                if (x < this._gridSize - 1) {
                    let rightTile = subgrid.tiles[x + 1][y],
                        rightBody = rightTile.body

                    if (rightBody && rightTile.shape == shape
                        && rightTile.layer == layer && rightTile.layerGroup == layerGroup && (rightBody._height == 1 || shape != 1)) {
                        rightBody._width += 1
                        rightBody._x -= 0.5
                        tile.body = rightBody
                        body = rightBody
                        this._updatedBodies.push(rightBody)
                    }
                }

                if (x > 0) {
                    let leftTile = subgrid.tiles[x - 1][y], leftBody = leftTile.body

                    if (leftBody && leftTile.shape == shape
                        && leftTile.layer == layer && leftTile.layerGroup == layerGroup && (leftBody._height == 1 || shape != 1)) {
                        if (body) {
                            let i = this._newBodies.indexOf(leftBody)
                            if (i >= 0) this._newBodies.splice(i, 1)
                            else this._oldBodies.push(leftBody)

                            body._width += leftBody._width
                            body._x -= leftBody._width / 2

                            for (let i = leftBody._x - xoffset - leftBody._width / 2; i < x; i++) {
                                subgrid.tiles[i][y].body = body
                            }
                        } else {
                            leftBody._width += 1
                            leftBody._x += 0.5
                            tile.body = leftBody
                            body = leftBody
                            this._updatedBodies.push(leftBody)
                        }
                    }
                }

                if (!body) {
                    if (shape == 1) {
                        fail = true
                    } else {
                        body = new Line(null, null);

                        (body as Line)._isHorizontal = true;
                        (body as Line)._size = 1;
                        body._x = x + 0.5 + xoffset

                        if (shape == 2) {
                            (body as Line)._oneway = 2
                            body._y = y + yoffset
                        } else {
                            (body as Line)._oneway = 1
                            body._y = y + yoffset + 1
                        }

                        body._entity = this._entity
                        body._enabled = true
                        body._layer = layer
                        body._layerGroup = layerGroup
                        body._grid = this
                        body._isSensor = false

                        tile.body = body
                        this._newBodies.push(body)
                    }
                }
            }

            if (shape == 3 || shape == 5 || shape == 1 && fail) {
                let body: SmallBody

                if (y < this._gridSize - 1) {
                    let upTile = subgrid.tiles[x][y + 1], upBody = upTile.body

                    if (upBody && upTile.shape == shape
                        && upTile.layer == layer && upTile.layerGroup == layerGroup && (upBody._width == 1 || shape != 1)) {
                        upBody._height += 1
                        upBody._y -= 0.5
                        tile.body = upBody
                        body = upBody
                        this._updatedBodies.push(upBody)
                    }
                }

                if (y > 0) {
                    let downTile = subgrid.tiles[x][y - 1], downBody = downTile.body

                    if (downBody && downTile.shape == shape
                        && downTile.layer == layer && downTile.layerGroup == layerGroup && (downBody._width == 1 || shape != 1)) {
                        if (body) {
                            let i = this._newBodies.indexOf(downBody)
                            if (i >= 0) this._newBodies.splice(i, 1)
                            else this._oldBodies.push(downBody)

                            body._height += downBody._height
                            body._y -= downBody._height / 2

                            for (let i = downBody._y - yoffset - downBody._height / 2; i < y; i++) {
                                subgrid.tiles[x][i].body = body
                            }
                        } else {
                            downBody._height += 1
                            downBody._y += 0.5
                            tile.body = downBody
                            body = downBody
                            this._updatedBodies.push(downBody)
                        }
                    }
                }

                if (!body) {
                    if (shape == 1) {
                        body = new Rect(null, null);

                        (body as Rect)._width = 1;
                        (body as Rect)._height = 1;

                        body._x = x + xoffset + 0.5
                        body._y = y + yoffset + 0.5
                    } else {
                        body = new Line(null, null);
                        (body as Line)._size = 1;
                        (body as Line)._isHorizontal = false;
                        (body as Line)._y = y + yoffset + 0.5

                        if (shape == 3) {
                            (body as Line)._oneway = 2
                            body._x = x + xoffset
                        } else {
                            (body as Line)._oneway = 1
                            body._x = x + xoffset + 1
                        }
                    }

                    body._entity = this._entity
                    body._enabled = true
                    body._layer = layer
                    body._layerGroup = layerGroup
                    body._grid = this
                    body._isSensor = false

                    this._newBodies.push(body)
                    tile.body = body
                }
            }
        }

        // UPDATE ADJACENT: IF EMPTY OR SIDE ADDED INSTEAD OF FULL, POTENTIALLY ADD FULL AND VICE VERSA
        if (shape == 1) {
            if (left && left.shape == 1 && left.layerGroup == layerGroup && left.layer == layer) {
                if (x > 1 && y > 0 && y < this._gridSize - 1) {
                    let leftTile = subgrid.tiles[x - 2][y],
                        upTile = subgrid.tiles[x - 1][y + 1],
                        downTile = subgrid.tiles[x - 1][y - 1]

                    if (leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup
                        && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup
                        && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup) {
                        this._removeBody(subgrid, left, x - 1, y, xoffset, yoffset)
                    }
                }
            }
            if (right && right.shape == 1 && right.layerGroup == layerGroup && right.layer == layer) {
                if (x < this._gridSize - 2 && y > 0 && y < this._gridSize - 1) {
                    let rightTile = subgrid.tiles[x + 2][y],
                        upTile = subgrid.tiles[x - 1][y + 1],
                        downTile = subgrid.tiles[x - 1][y - 1]

                    if (rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup
                        && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup
                        && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup) {
                        this._removeBody(subgrid, right, x + 1, y, xoffset, yoffset)
                    }
                }
            }
            if (up && up.shape == 1 && up.layerGroup == layerGroup && up.layer == layer) {
                if (x > 1 && x < this._gridSize - 1 && y < this._gridSize - 2) {
                    let leftTile = subgrid.tiles[x - 1][y + 1],
                        upTile = subgrid.tiles[x][y + 2],
                        rightTile = subgrid.tiles[x + 1][y + 1]

                    if (leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup
                        && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup
                        && rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup) {
                        this._removeBody(subgrid, up, x, y + 1, xoffset, yoffset)
                    }
                }
            }
            if (down && down.shape == 1 && down.layerGroup == layerGroup && down.layer == layer) {
                if (x < this._gridSize - 1 && x > 0 && y > 1) {
                    let rightTile = subgrid.tiles[x + 1][y - 1],
                        leftTile = subgrid.tiles[x - 1][y - 1],
                        downTile = subgrid.tiles[x][y - 2]

                    if (rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup
                        && leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup
                        && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup) {
                        this._removeBody(subgrid, down, x, y - 1, xoffset, yoffset)
                    }
                }
            }
        } else {
            if (left && left.shape == 1 && !left.body && x > 1 && y > 0 && y < this._gridSize - 1) {
                let leftTile = subgrid.tiles[x - 2][y],
                    upTile = subgrid.tiles[x - 1][y + 1],
                    downTile = subgrid.tiles[x - 1][y - 1]

                if (leftTile.body && leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup && leftTile.body._height == 1) {
                    leftTile.body._width += 1
                    leftTile.body._x += 0.5
                    left.body = leftTile.body
                    this._updatedBodies.push(left.body)
                } else if (upTile.body && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup && upTile.body._width == 1) {
                    upTile.body._height += 1
                    upTile.body._y -= 0.5
                    left.body = upTile.body
                    this._updatedBodies.push(left.body)
                } else if (downTile.body && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup && downTile.body._width == 1) {
                    downTile.body._height += 1
                    downTile.body._y += 0.5
                    left.body = downTile.body
                    this._updatedBodies.push(left.body)
                } else {
                    let newBody = new Rect(null, null)
                    newBody._entity = this._entity

                    newBody._width = 1
                    newBody._height = 1
                    newBody._x = x + xoffset - 0.5
                    newBody._y = y + yoffset + 0.5
                    newBody._enabled = true
                    newBody._layer = layer
                    newBody._layerGroup = layerGroup
                    newBody._grid = this
                    newBody._isSensor = false

                    this._newBodies.push(newBody)
                    left.body = newBody
                }
            }
            if (right && right.shape == 1 && !right.body && x < this._gridSize - 2 && y > 0 && y < this._gridSize - 1) {
                let rightTile = subgrid.tiles[x + 2][y],
                    upTile = subgrid.tiles[x + 1][y + 1],
                    downTile = subgrid.tiles[x + 1][y - 1]

                if (rightTile.body && rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup && rightTile.body._height == 1) {
                    rightTile.body._width += 1
                    rightTile.body._x -= 0.5
                    right.body = rightTile.body
                    this._updatedBodies.push(right.body)
                } else if (upTile.body && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup && upTile.body._width == 1) {
                    upTile.body._height += 1
                    upTile.body._y -= 0.5
                    right.body = upTile.body
                    this._updatedBodies.push(right.body)
                } else if (downTile.body && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup && downTile.body._width == 1) {
                    downTile.body._height += 1
                    downTile.body._y += 0.5
                    right.body = downTile.body
                    this._updatedBodies.push(right.body)
                } else {
                    let newBody = new Rect(null, null)
                    newBody._entity = this._entity

                    newBody._width = 1
                    newBody._height = 1
                    newBody._x = x + xoffset + 1.5
                    newBody._y = y + yoffset + 0.5
                    newBody._enabled = true
                    newBody._layer = layer
                    newBody._layerGroup = layerGroup
                    newBody._grid = this
                    newBody._isSensor = false

                    this._newBodies.push(newBody)
                    right.body = newBody
                }
            }
            if (up && up.shape == 1 && !up.body && y < this._gridSize - 2 && x > 0 && x < this._gridSize - 1) {
                let rightTile = subgrid.tiles[x + 1][y + 1],
                    leftTile = subgrid.tiles[x - 1][y + 1],
                    upTile = subgrid.tiles[x][y + 2]

                if (rightTile.body && rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup && rightTile.body._height == 1) {
                    rightTile.body._width += 1
                    rightTile.body._x -= 0.5
                    up.body = rightTile.body
                    this._updatedBodies.push(up.body)
                } else if (upTile.body && upTile.shape == 1 && upTile.layer == layer && upTile.layerGroup == layerGroup && upTile.body._width == 1) {
                    upTile.body._height += 1
                    upTile.body._y -= 0.5
                    up.body = upTile.body
                    this._updatedBodies.push(up.body)
                } else if (leftTile.body && leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup && leftTile.body._height == 1) {
                    leftTile.body._width += 1
                    leftTile.body._x += 0.5
                    up.body = leftTile.body
                    this._updatedBodies.push(up.body)
                } else {
                    let newBody = new Rect(null, null)
                    newBody._entity = this._entity

                    newBody._width = 1
                    newBody._height = 1
                    newBody._x = x + xoffset + 0.5
                    newBody._y = y + yoffset + 1.5
                    newBody._enabled = true
                    newBody._layer = layer
                    newBody._layerGroup = layerGroup
                    newBody._grid = this
                    newBody._isSensor = false

                    this._newBodies.push(newBody)
                    up.body = newBody
                }
            }
            if (down && down.shape == 1 && !down.body && y > 1 && x > 0 && x < this._gridSize - 1) {
                let rightTile = subgrid.tiles[x + 1][y - 1],
                    leftTile = subgrid.tiles[x - 1][y - 1],
                    downTile = subgrid.tiles[x][y - 2]

                if (rightTile.body && rightTile.shape == 1 && rightTile.layer == layer && rightTile.layerGroup == layerGroup && rightTile.body._height == 1) {
                    rightTile.body._width += 1
                    rightTile.body._x -= 0.5
                    down.body = rightTile.body
                    this._updatedBodies.push(down.body)
                } else if (downTile.body && downTile.shape == 1 && downTile.layer == layer && downTile.layerGroup == layerGroup && downTile.body._width == 1) {
                    downTile.body._height += 1
                    downTile.body._y += 0.5
                    down.body = downTile.body
                    this._updatedBodies.push(down.body)
                } else if (leftTile.body && leftTile.shape == 1 && leftTile.layer == layer && leftTile.layerGroup == layerGroup && leftTile.body._height == 1) {
                    leftTile.body._width += 1
                    leftTile.body._x += 0.5
                    down.body = leftTile.body
                    this._updatedBodies.push(down.body)
                } else {
                    let newBody = new Rect(null, null)
                    newBody._entity = this._entity

                    newBody._width = 1
                    newBody._height = 1
                    newBody._x = x + xoffset + 0.5
                    newBody._y = y + yoffset - 0.5
                    newBody._enabled = true
                    newBody._layer = layer
                    newBody._layerGroup = layerGroup
                    newBody._grid = this
                    newBody._isSensor = false

                    this._newBodies.push(newBody)
                    down.body = newBody
                }
            }
        }
    }
    _updateTileSensorBody(subgrid: SubGrid, tile: Tile, x: number, y: number, xoffset: number, yoffset: number, isSensor: boolean, sensorLayer, sensorLayerGroup) {
        let body = tile.sensor

        if (body) {
            if (body._width == 1) {
                let i = this._newBodies.indexOf(body)
                if (i >= 0) this._newBodies.splice(i, 1)
                else this._oldBodies.push(body)
            } else if (x + xoffset == body._x - body._width / 2) {
                body._width -= 1
                body._x += 0.5
                this._updatedBodies.push(body)
            } else if (x + xoffset == body._x + body._width / 2 - 1) {
                body._width -= 1
                body._x -= 0.5
                this._updatedBodies.push(body)
            } else {
                let newBody = new Rect(null, null)
                newBody._entity = this._entity

                newBody._width = x + xoffset - body._x + body._width / 2
                newBody._height = 1
                newBody._x = x - newBody._width / 2 + xoffset
                newBody._y = y + yoffset + 0.5
                newBody._enabled = true
                newBody._layer = sensorLayer
                newBody._layerGroup = sensorLayerGroup
                newBody._grid = this
                newBody._isSensor = true
                this._newBodies.push(newBody)

                body._width -= newBody._width + 1
                body._x += (newBody._width + 1) / 2
                this._updatedBodies.push(body)
            }
            tile.sensor = null
        }

        if (isSensor) {
            let rightBody: Rect, body: Rect

            if (x < this._gridSize - 1) {
                let rightTile = subgrid.tiles[x + 1][y]
                rightBody = rightTile.sensor

                if (rightBody && rightTile.sensorLayer == sensorLayer && rightTile.sensorLayerGroup == sensorLayerGroup) {
                    rightBody._width += 1
                    rightBody._x -= 0.5
                    tile.sensor = rightBody
                    body = rightBody
                    this._updatedBodies.push(body)
                }
            }

            if (x > 0) {
                let leftTile = subgrid.tiles[x - 1][y]
                let leftBody: Rect = leftTile.sensor

                if (leftBody && leftTile.sensorLayer == sensorLayer && leftTile.sensorLayerGroup == sensorLayerGroup) {
                    if (body) {
                        let i = this._newBodies.indexOf(leftBody)
                        if (i >= 0) this._newBodies.splice(i, 1)
                        else this._oldBodies.push(leftBody)

                        rightBody._width += leftBody._width
                        rightBody._x -= leftBody._width / 2

                        for (let i = leftBody._y - xoffset - leftBody._width; i < x; i++) {
                            subgrid.tiles[i][y].sensor = rightBody
                        }
                    } else {
                        leftBody._width += 1
                        leftBody._x += 0.5
                        tile.sensor = leftBody
                        body = leftBody
                        this._updatedBodies.push(body)
                    }
                }
            }

            if (!body) {
                body = new Rect(null, null)
                body._entity = this._entity

                body._x = x + 0.5 + xoffset
                body._y = y + 0.5 + yoffset
                body._width = 1
                body._height = 1
                body._enabled = true
                body._layer = sensorLayer
                body._layerGroup = sensorLayerGroup
                body._grid = this
                body._isSensor = true

                tile.sensor = body
                this._newBodies.push(body)
            }
        }
    }

    _updateTileBodies(subgrid: SubGrid, tile: Tile, x: number, y: number, xoffset: number, yoffset: number, shape: number, data) {
        let newLayer = data && typeof data.layer != "undefined" ? this._entity.world._layerIds[data.layer] : tile.layer,
            newLayerGroup = data && typeof data.layerGroup != "undefined" ? data.layerGroup : tile.layerGroup,
            newIsSensor = data && typeof data.isSensor != "undefined" ? data.isSensor : tile.sensor,
            newIsSensorLayer = data && typeof data.sensorLayer != "undefined" ? data.sensorLayer : tile.sensorLayer,
            newIsSensorLayerGroup = data && typeof data.sensorLayerGroup != "undefined" ? data.sensorLayerGroup : tile.sensorLayerGroup

        if (shape != tile.shape || newLayer != tile.layer || newLayerGroup != tile.layerGroup) {
            this._updateTileBody(subgrid, tile, x, y, xoffset, yoffset, shape, newLayer, newLayerGroup)
        }

        if (newIsSensor != tile.sensor || newIsSensorLayer != tile.sensorLayer || newIsSensorLayerGroup != tile.sensorLayerGroup) {
            this._updateTileSensorBody(subgrid, tile, x, y, xoffset, yoffset, newIsSensor, newIsSensorLayer, newIsSensorLayerGroup)
        }
    }

    _setTile(x: number, y: number, shape: number, data?) {
        let subgrid: SubGrid,
            tile: Tile

        this._oldBodies = []
        this._newBodies = []
        this._updatedBodies = []

        // FIND WHICH SUBGRID TO AFFECT + AJUST X/Y POSITION
        if (this._subGrids instanceof SubGrid) {
            subgrid = this._subGrids
            tile = subgrid.tiles[x][y]
            this._updateTileBodies(subgrid, tile, x, y, this._xdownLeft, this._ydownLeft, shape, data)
        } else {
            let gridx = Math.floor(x / this._gridSize), gridy = Math.floor(y / this._gridSize)

            subgrid = this._subGrids[gridx][gridy]

            x -= gridx * this._gridSize
            y -= gridy * this._gridSize

            tile = subgrid.tiles[x][y]
            this._updateTileBodies(
                subgrid, tile,
                x, y,
                this._xdownLeft + gridx * this._gridSize, this._ydownLeft + gridy * this._gridSize,
                shape, data
            )
        }

        for (let b of this._oldBodies) { this._topEntity.removeBody(b) }
        for (let b of this._newBodies) { this._topEntity._addBody(b) }
        if (this._topEntity._allBodies) {
            for (let b of this._updatedBodies) {
                if (this._oldBodies.indexOf(b) < 0 && this._newBodies.indexOf(b) < 0) {
                    this._topEntity._allBodies.updateAABB(b)
                }
            }
        } else if (this._topEntity._bodies && !(this._topEntity._bodies instanceof Body)) {
            for (let b of this._updatedBodies) {
                if (this._oldBodies.indexOf(b) < 0 && this._newBodies.indexOf(b) < 0) {
                    this._topEntity._bodies.updateAABB(b)
                }
            }
        }

        // DATA MODIFICATION
        if (typeof data != "undefined") {
            if (tile.data) {
                tile.data = data && Object.assign(tile.data, data)
            } else {
                tile.data = _.cloneDeep(data)
            }
        }
        tile.shape = shape

        this._topEntity._resetMaxx()
        this._topEntity._resetMinx()
        this._topEntity._resetMaxy()
        this._topEntity._resetMiny()
    }
    _setTiles(x: number, y: number, width: number, height: number, info: (x: number, y: number, shape: number, data?) => ({ shape: number, data?} | number)) {
        let small = this._subGrids instanceof SubGrid

        if (small) {
            this._newBodies = []
            this._oldBodies = []
            this._updatedBodies = []

            this._setTilesInSubGrid(
                x, x + width,
                y, y + height,
                this._xdownLeft, this._ydownLeft,
                this._subGrids as SubGrid,
                (xx, yy, shape, data?) => info(xx + this._xdownLeft, yy + this._ydownLeft, shape, data)
            )

            for (let b of this._oldBodies) { this._entity.removeBody(b) }
            for (let b of this._newBodies) { this._entity._addBody(b) }
        } else {
            this._newBodies = []
            this._oldBodies = []

            let gridminx = Math.floor(x / this._gridSize),
                gridminy = Math.floor(y / this._gridSize),
                gridmaxx = Math.floor((x + width) / this._gridSize),
                gridmaxy = Math.floor((y + height) / this._gridSize)

            for (let gridx = gridminx; gridx <= gridmaxx; gridx++) {
                for (let gridy = gridminy; gridy <= gridmaxy; gridy++) {
                    let xoff = gridx * this._gridSize, yoff = gridy * this._gridSize
                    let xoff2 = xoff + this._xdownLeft, yoff2 = yoff + this._ydownLeft

                    let subgrid: SubGrid = this._subGrids[gridx][gridy]
                    if (!subgrid) {
                        subgrid = new SubGrid(this._gridSize)
                        this._subGrids[gridx][gridy] = subgrid
                    }

                    this._setTilesInSubGrid(
                        Math.max(0, x - xoff),
                        Math.min(this._gridSize, x + width - xoff),
                        Math.max(0, y - yoff),
                        Math.min(this._gridSize, y + height - yoff),
                        xoff2, yoff2,
                        subgrid,
                        (x, y, shape, data?) => info(x + xoff2, y + yoff2, shape, data)
                    )
                }
            }

            for (let b of this._oldBodies) { this._entity.removeBody(b) }
            for (let b of this._newBodies) { this._entity._addBody(b) }
            if (this._topEntity._allBodies) {
                for (let b of this._updatedBodies) {
                    this._topEntity._allBodies.updateAABB(b)
                }
            } else if (this._topEntity._bodies && !(this._topEntity._bodies instanceof Body)) {
                for (let b of this._updatedBodies) {
                    this._topEntity._bodies.updateAABB(b)
                }
            }
        }

        this._topEntity._resetMaxx()
        this._topEntity._resetMinx()
        this._topEntity._resetMaxy()
        this._topEntity._resetMiny()
    }
    _setTilesInSubGrid(minx: number, maxx: number, miny: number, maxy: number, xoffset, yoffset, subgrid: SubGrid,
        info: (x: number, y: number, shape: number, data?) => ({ shape: number, data?} | number)) {
        for (let j = miny; j < maxy; j++) {
            for (let i = minx; i < maxx; i++) {
                let tile = subgrid.tiles[i][j],
                    res = info(i, j, tile.shape, tile.data)
                if (res) {
                    if (typeof res == "number") {
                        this._updateTileBodies(subgrid, tile, i, j, xoffset, yoffset, res, undefined)
                        tile.shape = res
                    } else {
                        this._updateTileBodies(subgrid, tile, i, j, xoffset, yoffset, res.shape, res.data)
                        tile.shape = res.shape
                        if (typeof res.data != "undefined") {
                            if (tile.data) {
                                tile.data = res.data && Object.assign(tile.data, res.data)
                            } else {
                                tile.data = _.cloneDeep(res.data)
                            }
                        }
                    }
                }
            }
        }
    }

    _expandGrid(minx: number, miny: number, maxx: number, maxy: number) {
        if (minx < 0 || miny < 0 || maxx >= this._gridSize * this._width || maxy >= this._gridSize * this._height) {
            let left = Math.max(Math.ceil(-minx / this._gridSize), 0),
                right = Math.max(Math.floor(maxx / this._gridSize) - this._width + 1, 0),
                up = Math.max(Math.floor(maxy / this._gridSize) - this._height + 1, 0),
                down = Math.max(Math.ceil(-miny / this._gridSize), 0)

            let grid: SubGrid[][], newWidth, newHeight

            if (left > 0 || right > 0 || up > 0 || down > 0) {
                if (this._subGrids instanceof SubGrid) {
                    newWidth = left + 1 + right
                    newHeight = down + 1 + up
                    grid = new Array(newWidth)
                    for (let i = 0; i < newWidth; i++) {
                        grid[i] = new Array(newHeight)
                    }
                    for (let i = 0; i < newWidth; i++) {
                        for (let j = 0; j < newHeight; j++) {
                            if (i == left && j == down) {
                                grid[i][j] = this._subGrids
                            } else {
                                grid[i][j] = new SubGrid(this._gridSize)
                            }
                        }
                    }
                } else {
                    newWidth = left + this._width + right
                    newHeight = down + this._height + up
                    grid = new Array(newWidth)
                    for (let i = 0; i < newWidth; i++) {
                        grid[i] = new Array(newHeight)
                    }
                    for (let i = 0; i < newWidth; i++) {
                        for (let j = 0; j < newHeight; j++) {
                            if (i >= left && j >= down && i < left + this._width && j < down + this._height) {
                                grid[i][j] = this._subGrids[i - left][j - down]
                            } else {
                                grid[i][j] = new SubGrid(this._gridSize)
                            }
                        }
                    }
                }

                this._subGrids = grid
                this._width = newWidth
                this._height = newHeight
                this._xdownLeft -= left * this._gridSize
                this._ydownLeft -= down * this._gridSize
            }
        }
    }
}

export class SubGrid {

    tiles: Tile[][]

    constructor(size: number) {
        this.tiles = new Array(size)

        for (let i = 0; i < size; i++) {
            this.tiles[i] = new Array(size)

            for (let j = 0; j < size; j++) {
                this.tiles[i][j] = {
                    shape: 0,
                    layer: 0,
                    layerGroup: 0,

                    sensorLayer: 0,
                    sensorLayerGroup: 0,

                    data: null,
                    body: null,
                    sensor: null
                }
            }
        }
    }
}

interface Tile {
    shape: number
    layer: number
    layerGroup: number

    sensorLayer: number
    sensorLayerGroup: number

    data: any
    body: SmallBody
    sensor: Rect
}