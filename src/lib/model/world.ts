import * as _ from 'lodash'

import { Entity, EntityArgs } from './entity'
import { Body, SmallBody, Rect, Line, RectArgs, LineArgs, GridArgs } from './body'

import { RaycastResult, QueryResult } from './query'
import { MoveVBH, SimpleMoveVBH, VBH } from '../vbh/vbh'
import { BinaryTree, MoveBinaryTree } from '../vbh/binaryTree'
import { LayerCollision } from './enums'

export const EPS = 0.001

export function createWorld() {
    return new World()
}

export class World {

    _time: number
    
    _layerIds: any
    _layerNames: string[]
    _layers: number[]

    _ents: Entity[][]

    _vbh: MoveVBH<Entity>

    _broadphaseTime: number = 0
    _narrowphaseTime: number = 0

    // CACHE
    _newOverlap: SmallBody[][]
    _hasInvalidOverlap: boolean

    constructor(userSpatialRegions?: boolean) {
        this._time = 0

        this._layerIds = {}
        this._layerNames = new Array(32)
        this._layers = new Array(64)

        this._layerIds["default"] = 0
        this._layerNames[0] = "default"
        for(let i = 0; i < 64; i++) {
            this._layers[i] = 0xFFFFFFFF
        }

        this._ents = []

        if (userSpatialRegions) {
            this._vbh = new MoveBinaryTree<Entity>()
        } else {
            this._vbh = new SimpleMoveVBH<Entity>()
        }
    }

    // ##### TIME
    get time(): number { return this._time }
    set time(val: number) { console.log("[ERROR] you can't change the time")}

    get layers(): string[] { return Object.keys(this._layerIds).filter(l => l) }

    // ##### LAYER
    _getLayer(layer: string): number {
        let id = this._layerIds[layer]

        if(id != null) {
            return id
        } else {
            this.addLayer(layer)
            let id = this._layerIds[layer]
            if(id != null) {
                return id
            } else {
                return 0
            }
        }
    }
    addLayer(layer: string) {
        let i = 1
        while(i < 32 && this._layerNames[i] != null) {
            i++
        }
        if(i == 32) {
            console.log("[ERROR] Can't add layer: no more layers available" + (null as any).a)
        } else {
            this._layerNames[i] = layer
            this._layerIds[layer] = i
        }
    }
    setLayerRule(layer1: string, layer2: string, rule: string) {
        // TODO CLEAR ALL CONTACTS THAT DON'T FIT THE NEW RULE
        if(this._layerIds[layer1] == null) {
            this.addLayer(layer1)
        }
        if(this._layerIds[layer2] == null) {
            this.addLayer(layer2)
        }
        
        let id1 = this._layerIds[layer1],
            id2 = this._layerIds[layer2]
        
        if(id2 >= 16) {
            let add, clear = ~(3 << (2 * id2 - 16))
            switch(rule) {
                case LayerCollision.ALWAYS: add = 3 << (2 * id2 - 16); break
                case LayerCollision.EQUAL_GROUP: add = 2 << (2 * id2 - 16); break
                case LayerCollision.UNEQUAL_GROUP: add = 1 << (2 * id2 - 16); break
                case LayerCollision.NEVER: add = 0; break
            }
            this._layers[id1+32] = ((this._layers[id1+32] & clear) | add)
        } else {
            let add, clear = ~(3 << 2 * id2)
            switch(rule) {
                case LayerCollision.ALWAYS: add = 3 << (2 * id2); break
                case LayerCollision.EQUAL_GROUP: add = 2 << (2 * id2); break
                case LayerCollision.UNEQUAL_GROUP: add = 1 << (2 * id2); break
                case LayerCollision.NEVER: add = 0; break
            }
            this._layers[id1] = ((this._layers[id1] & clear) | add)
        }
        if(id1 != id2) {
            if(id1 >= 16) {
                let add, clear = ~(3 << (2 * id1 - 16))
                switch(rule) {
                    case LayerCollision.ALWAYS: add = 3 << (2 * id1 - 16); break
                    case LayerCollision.EQUAL_GROUP: add = 2 << (2 * id1 - 16); break
                    case LayerCollision.UNEQUAL_GROUP: add = 1 << (2 * id1 - 16); break
                    case LayerCollision.NEVER: add = 0; break
                }
                this._layers[id2+32] = ((this._layers[id2+32] & clear) | add)
            } else {
                let add, clear = ~(3 << 2 * id1)
                switch(rule) {
                    case LayerCollision.ALWAYS: add = 3 << (2 * id1); break
                    case LayerCollision.EQUAL_GROUP: add = 2 << (2 * id1); break
                    case LayerCollision.UNEQUAL_GROUP: add = 1 << (2 * id1); break
                    case LayerCollision.NEVER: add = 0; break
                }
                this._layers[id2] = ((this._layers[id2] & clear) | add)
            }
        }
    }
    _getLayerRule(id1: number, id2: number): number {
        if(id2 < 16) {
            let b = 2 * id2, a = 3 << b
            return (this._layers[id1] & a) >> b
        } else {
            let b = (2 * id2 - 16), a = 3 << b
            return (this._layers[id1 + 32] & a) >> b
        }
    }
    getLayerRule(layer1: string, layer2: string): string {
        let id1 = this._layerIds[layer1],
            id2 = this._layerIds[layer2]
        
        switch(this._getLayerRule(id1, id2)) {
            case 0x3: return LayerCollision.ALWAYS
            case 0x2: return LayerCollision.EQUAL_GROUP
            case 0x1: return LayerCollision.UNEQUAL_GROUP
            case 0: return LayerCollision.NEVER
        }
    }

    // ##### ENTITIES
    createEntity(args: EntityArgs): Entity {
        let entity = new Entity(this, args)
        this._addEntity(entity)
        return entity
    }
    createRect(args: RectArgs & { level?: number }): Entity {
        (args as any).type = "rect"
        let entity = new Entity(this, args as any)
        this._addEntity(entity)
        return entity
    }
    createLine(args: LineArgs & { level?: number }): Entity {
        (args as any).type = "line"
        let entity = new Entity(this, args as any)
        this._addEntity(entity)
        return entity
    }
    createGrid(args: GridArgs & { level?: number }): Entity {
        (args as any).type = "grid"
        let entity = new Entity(this, args as any)
        this._addEntity(entity)
        return entity
    }
    _addEntity(entity: Entity) {
        if(this._ents[entity._level]) {
            this._ents[entity._level].push(entity)
        } else {
            this._ents[entity._level] = [entity]
        }
        this._addTopEntity(entity)
    }
    _addTopEntity(entity: Entity) {
        this._vbh.insert(entity)
    }
    _removeTopEntity(entity: Entity) {
        this._vbh.remove(entity)
    }
    removeEntity(entity: Entity) {
        if(entity == entity._topEntity) {
            this._removeTopEntity(entity)
        }
        entity._setParent(null, 0)
        for(let c of _.clone(entity._childs)) {
            c._setParent(null, 0)
        }
        let i = this._ents[entity.level].indexOf(entity)
        if(i >= 0) {
            this._ents[entity.level].splice(i, 1)
        }
        entity._listener = null
    }

    // ##### QUERYING
    raycast(x: number, y: number, dx: number, dy: number): RaycastResult<Body> {
        return null
    }
    queryRect(x: number, y: number, w: number, h: number): QueryResult<Body> {
        return null
    }
    queryPoint(x: number, y: number): QueryResult<Body> {
        return this.queryRect(x, y, 0, 0)
    }

    // ##### SIMULATION
    simulate(delta: number) {
        this._time += delta

        // I. GET ALL POTENTIAL COLLISION, FILTERED OUT
        let t0 = typeof window !== 'undefined' && performance.now()
        this._broadphase(delta)
        let t1 = typeof window !== 'undefined' && performance.now()

        // II. SOLVE INVALID STATE + SOLVE MOVEMENT OF ALL ENTITIES: DEFINE NEW X, Y, VX, VY AND CONTACTS
        for(let level in this._ents) {
            let currentEnts = this._ents[level]

            for(let ent of currentEnts) {
                let oldx = ent._x, oldy = ent._y,
                    time: number = 0

                // INVALID STATE SOLVING
                this._hasInvalidOverlap = false
                let hadOverlap: boolean = ent._invalidOverlap.length > 0

                this._newOverlap = null
                ent._invalidOverlap.forEach((o: SmallBody[]) => {
                    this._handleOverlap(ent, o, o[0], o[1], delta)
                })
                ent._potContacts.forEach((o: SmallBody[]) => {
                    if (this._newOverlap) {
                        let i = 0, len = this._newOverlap.length
                        while(i < len && o[0] != this._newOverlap[i][0] && o[1] != this._newOverlap[i][1]) i++

                        if (i == len) this._handleOverlap(ent, o, o[0], o[1], delta)
                    } else {
                        this._handleOverlap(ent, o, o[0], o[1], delta)
                    }
                })
                if (this._newOverlap) ent._invalidOverlap = this._newOverlap
                else if(hadOverlap) ent._invalidOverlap = []

                if (hadOverlap != this._hasInvalidOverlap && ent._listener) {
                    if (hadOverlap) {
                        if (ent._listener.crushEnd) ent._listener.crushEnd() 
                    } else {
                        if (ent._listener.crushStart) ent._listener.crushStart()
                    }
                } 

                // CALCULATE SPEED WITH PARENT
                if (ent._parent) {
                    ent._vx += ent._parent._simvx
                    ent._vy += ent._parent._simvy
                }

                let endOfCourse = false
                let a = 0
                while(!endOfCourse && a < 10) {
                    a++
                    // ADJUST SPEED DUE TO LOWER CONTACTS + REMOVE LOST CONTACTS
                    if(ent._leftLower) {
                        let sub = ent._leftLower.otherBody._topEntity
                        if(ent._vx > sub._simvx) {
                            ent._removeLeftLowerContact()
                        } else {
                            ent._vx = sub._simvx
                        }
                    }
                    if(ent._rightLower) {
                        let sub = ent._rightLower.otherBody._topEntity
                        if(ent._vx < sub._simvx) {
                            ent._removeRightLowerContact()
                        } else {
                            ent._vx = sub._simvx
                        }
                    }
                    if(ent._downLower) {
                        let sub = ent._downLower.otherBody._topEntity
                        if(ent._vy > sub._simvy) {
                            ent._removeDownLowerContact()
                        } else {
                            ent._vy = sub._simvy
                        }
                    }
                    if(ent._upLower) {
                        let sub = ent._upLower.otherBody._topEntity
                        if(ent._vy < sub._simvy) {
                            ent._removeUpLowerContact()
                        } else {
                            ent._vy = sub._simvy
                        }
                    }
                    
                    if(ent._potContacts.length > 0) {
                        // CALCULATE POTENTIAL COLLISION INFO
                        let narrows = ent._potContacts.map(pair => {
                            return this._narrowPhase(pair[0] as Rect, pair[1] as Rect, 
                                pair[0]._x + ent._x, pair[0]._y + ent._y, 
                                pair[1]._x + pair[1]._topEntity._x + pair[1]._topEntity._simvx * (time - delta), 
                                pair[1]._y + pair[1]._topEntity._y + pair[1]._topEntity._simvy * (time - delta),
                                ent._vx, ent._vy,
                                pair[1]._topEntity._simvx, pair[1]._topEntity._simvy,
                                delta - time
                            )
                        }).filter(n => n)

                        // DECIDE BEHAVIOUR
                        if(narrows.length > 0) {
                            // DEFINE NEW CONTACTS DUE TO COLLISIONS
                            let firstTime = Infinity,
                                first: NarrowResult
                            narrows.forEach(n => {
                                if(n.time < firstTime) {
                                    switch(n.side) {
                                        case 2: {
                                            if(ent._downLower) {
                                                if((n.otherBody as SmallBody)._upCollide) { 
                                                    ent._invalidOverlap.push([n.body, n.otherBody])
                                                    if(ent._invalidOverlap.length == 1 && ent._listener && ent._listener.crushStart) {
                                                        ent._listener.crushStart()
                                                    }
                                                }
                                            } else {
                                                firstTime = n.time
                                                first = n
                                            }
                                            break
                                        }
                                        case 3: {
                                            if(ent._upLower) {
                                                if((n.otherBody as SmallBody)._downCollide) {
                                                    ent._invalidOverlap.push([n.body, n.otherBody])
                                                    if(ent._invalidOverlap.length == 1 && ent._listener && ent._listener.crushStart) {
                                                        ent._listener.crushStart()
                                                    }
                                                }
                                            } else {
                                                firstTime = n.time
                                                first = n
                                            }
                                            break
                                        }
                                        case 1: {
                                            if(ent._rightLower) {
                                                if((n.otherBody as SmallBody)._leftCollide) {
                                                    ent._invalidOverlap.push([n.body, n.otherBody])
                                                    if(ent._invalidOverlap.length == 1 && ent._listener && ent._listener.crushStart) {
                                                        ent._listener.crushStart()
                                                    }
                                                }
                                            } else {
                                                firstTime = n.time
                                                first = n
                                            }
                                            break
                                        }
                                        case 0: {
                                            if(ent._leftLower) {
                                                if((n.otherBody as SmallBody)._rightCollide) {
                                                    ent._invalidOverlap.push([n.body, n.otherBody])
                                                    if(ent._invalidOverlap.length == 1 && ent._listener && ent._listener.crushStart) {
                                                        ent._listener.crushStart()
                                                    }
                                                }
                                            } else {
                                                firstTime = n.time
                                                first = n
                                            }
                                            break
                                        }
                                    }
                                }
                            })

                            if(!first) {
                                endOfCourse = true
                            } else {
                                // UPDATE X, Y, TIME
                                ent._x = first.x - first.body._x
                                ent._y = first.y - first.body._y
                                time += first.time
                                
                                if(!first.otherBody._higherContacts) { first.otherBody._higherContacts = [] }

                                switch(first.side) {
                                    case 2: {
                                        if(ent._upLower) { ent._removeUpLowerContact() }
                                        ent._upLower = { body: first.body, otherBody: first.otherBody, side: first.side }
                                        first.otherBody._higherContacts.push(ent._upLower)
                                        break
                                    }
                                    case 3: {
                                        if(ent._downLower) { ent._removeDownLowerContact() }
                                        ent._downLower = { body: first.body, otherBody: first.otherBody, side: first.side }
                                        first.otherBody._higherContacts.push(ent._downLower)
                                        break
                                    }
                                    case 1: {
                                        if(ent._leftLower) { ent._removeLeftLowerContact() }
                                        ent._leftLower = { body: first.body, otherBody: first.otherBody, side: first.side }
                                        first.otherBody._higherContacts.push(ent._leftLower)
                                        break
                                    }
                                    case 0: {
                                        if(ent._rightLower) { ent._removeRightLowerContact() }
                                        ent._rightLower = { body: first.body, otherBody: first.otherBody, side: first.side }
                                        first.otherBody._higherContacts.push(ent._rightLower)
                                        break
                                    }
                                }
                            }
                        } else {
                            endOfCourse = true
                        }
                    } else {
                        endOfCourse = true
                    }

                    if (endOfCourse) {
                        ent._x += (delta - time) * ent._vx
                        ent._y += (delta - time) * ent._vy
                    }

                    // REMOVE CONTACTS DUE TO SLIDE OFF
                    if (ent._leftLower) {
                        if(Math.abs(ent._leftLower.body._y + ent._y - ent._leftLower.otherBody._y - ent._leftLower.otherBody._topEntity._y) * 2 
                            > (ent._leftLower.body as SmallBody)._height + (ent._leftLower.otherBody as SmallBody)._height) {
                            ent._removeLeftLowerContact()
                        }
                    }
                    if (ent._rightLower) {
                        if(Math.abs(ent._rightLower.body._y + ent._y - ent._rightLower.otherBody._y - ent._rightLower.otherBody._topEntity._y) * 2 
                            > (ent._rightLower.body as SmallBody)._height + (ent._rightLower.otherBody as SmallBody)._height) {
                            ent._removeRightLowerContact()
                        }
                    }
                    if (ent._upLower) {
                        if(Math.abs(ent._upLower.body._x + ent._x - ent._upLower.otherBody._x - ent._upLower.otherBody._topEntity._x) * 2 
                            > (ent._upLower.body as SmallBody)._width + (ent._upLower.otherBody as SmallBody)._width) {
                            ent._removeUpLowerContact()
                        }
                    }
                    if (ent._downLower) {
                        if(Math.abs(ent._downLower.body._x + ent._x - ent._downLower.otherBody._x - ent._downLower.otherBody._topEntity._x) * 2 
                            > (ent._downLower.body as SmallBody)._width + (ent._downLower.otherBody as SmallBody)._width) {
                            ent._removeDownLowerContact()
                        }
                    }
                }

                // CORRECT SPEED FOR PARENT
                if(ent._parent) {
                    ent._vx -= ent._parent._simvx
                    ent._vy -= ent._parent._simvy
                }

                // RESET POTENTIAL CONTACTS
                ent._potContacts = []

                // PREPARE FOR NEXT LEVEL
                ent._simvx = (ent._x - oldx) / delta
                ent._simvy = (ent._y - oldy) / delta
            }
        }

        let t2 = typeof window !== 'undefined' && performance.now()
        this._broadphaseTime = t1 - t0
        this._narrowphaseTime = t2 - t1
    }
    _move(entity: Entity, dx: number, dy: number) {

    }

    // SIMULATION PROCEDURES
    _broadphase(delta: number) {
        for(let level in this._ents) {
            let ents = this._ents[level]
            for(let e of ents) {
                if (e._overlap)
                    e._overlap = e._overlap.filter((p: SmallBody[]) => {
                        let res = p[1]._topEntity._x + p[1]._x + p[1]._width/2 >= p[0]._topEntity._x + p[0]._x - p[0]._width/2
                            && p[1]._topEntity._x + p[1]._x - p[1]._width/2 <= p[0]._topEntity._x + p[0]._x + p[0]._width/2
                            && p[1]._topEntity._y + p[1]._y + p[1]._height/2 >= p[0]._topEntity._y + p[0]._y - p[0]._height/2
                            && p[1]._topEntity._y + p[1]._y - p[1]._height/2 <= p[0]._topEntity._y + p[0]._y + p[0]._height/2

                        if (e._listener && e._listener.overlapEnd && !res) {
                            e._listener.overlapEnd(p[0], p[1])
                        }

                        return res
                })

                e.moveMinX = e.minX + Math.min(0, e._vx * delta) * 2 - 0.1
                e.moveMaxX = e.maxX + Math.max(0, e._vx * delta) * 2 + 0.1
                e.moveMinY = e.minY + Math.min(0, e._vy * delta) * 2 - 0.1
                e.moveMaxY = e.maxY + Math.max(0, e._vy * delta) * 2 + 0.1
            }
        }

        let overlapBodies: SmallBody[][] = []
        
        this._vbh.collisions().forEach(pair => {
            let e1: Entity = pair[0], e2: Entity = pair[1]
            
            if(e2._bodies instanceof SmallBody) {
                if (e2.enabled) {
                    if(e1._bodies instanceof SmallBody) {
                        if (e1.enabled) {
                            overlapBodies.push([e1._bodies as SmallBody, e2._bodies as SmallBody])
                        }
                    } else {
                        let vbh = e1._allBodies || e1._bodies as VBH<Body>
                        overlapBodies.push.apply(overlapBodies, vbh.collideAABB(
                            e2._bodies as SmallBody,
                            e1.globalx, e1.globaly, e1.globalvx, e1.globalvy,
                            e2.globalx, e2.globaly + e2._bodies._y, e2.globalvx, e2.globalvy
                        ))
                    }
                }
            } else {
                if(e1._bodies instanceof SmallBody) {
                    if (e1._bodies.enabled) {
                        let vbh = e2._allBodies || e2._bodies as VBH<Body>
                        overlapBodies.push.apply(overlapBodies, vbh.collideAABB(
                            e1._bodies as SmallBody,
                            e2.globalx, e2.globaly, e2.globalvx, e2.globalvy,
                            e1.globalx, e1.globaly, e1.globalvx, e1.globalvy
                        ))
                    }
                } else {
                    let vbh1 = e2._allBodies || e2._bodies as VBH<Body>,
                        vbh2 = e1._allBodies || e1._bodies as VBH<Body>
                    overlapBodies.push.apply(overlapBodies, vbh1.collideVBH(
                        vbh2, 
                        e2.globalx, e2.globaly, e2.globalvx, e2.globalvy,
                        e1.globalx, e1.globaly, e1.globalvx, e1.globalvy
                    ))
                }
            }
        })

        overlapBodies
        .filter(pair => {
            switch(this._getLayerRule(pair[0]._layer, pair[1]._layer)) {
                case 0x3: return true
                case 0x2: return pair[0]._layerGroup == pair[1]._layerGroup
                case 0x1: return pair[0]._layerGroup != pair[1]._layerGroup
                case 0: return false
            }
        })
        .filter(p => {
            if(p[0]._isSensor || p[1]._isSensor) {
                if(!p[0]._entity._overlap || !_.some(p[0]._entity._overlap, o => o[1] == p[1])) {
                    if (!(p[1]._topEntity._x + p[1]._x + p[1]._width/2 < p[0]._topEntity._x + p[0]._x - p[0]._width/2
                        || p[1]._topEntity._x + p[1]._x - p[1]._width/2 > p[0]._topEntity._x + p[0]._x + p[0]._width/2
                        || p[1]._topEntity._y + p[1]._y + p[1]._height/2 < p[0]._topEntity._y + p[0]._y - p[0]._height/2
                        || p[1]._topEntity._y + p[1]._y - p[1]._height/2 > p[0]._topEntity._y + p[0]._y + p[0]._height/2)) {
                        if(!p[1]._entity._overlap) { p[1]._entity._overlap = [] }
                        if(!p[0]._entity._overlap) { p[0]._entity._overlap = [] }
                        p[0]._entity._overlap.push(p)
                        p[1]._entity._overlap.push([p[1], p[0]])

                        if (p[0]._entity._listener && p[0]._entity._listener.overlapStart) p[0]._entity._listener.overlapStart(p[0], p[1])
                        if (p[1]._entity._listener && p[1]._entity._listener.overlapStart) p[1]._entity._listener.overlapStart(p[1], p[0])
                    }
                }
                return false
            } else {
                return true
            }
        })
        .forEach(p => {
            let e1 = p[0]._topEntity, e2 = p[1]._topEntity
            if(e1._level != e2._level) {
                if(e1._level > e2._level) e1._potContacts.push([p[0], p[1]])
                else e2._potContacts.push([p[1], p[0]])
            } else {
                if(!p[0]._entity._overlap || !_.some(p[0]._entity._overlap, o => o[1] == p[1])) {
                    if (!(p[1]._topEntity._x + p[1]._x + p[1]._width/2 < p[0]._topEntity._x + p[0]._x - p[0]._width/2
                        || p[1]._topEntity._x + p[1]._x - p[1]._width/2 > p[0]._topEntity._x + p[0]._x + p[0]._width/2
                        || p[1]._topEntity._y + p[1]._y + p[1]._height/2 < p[0]._topEntity._y + p[0]._y - p[0]._height/2
                        || p[1]._topEntity._y + p[1]._y - p[1]._height/2 > p[0]._topEntity._y + p[0]._y + p[0]._height/2)) {
                        if(!p[1]._entity._overlap) { p[1]._entity._overlap = [] }
                        if(!p[0]._entity._overlap) { p[0]._entity._overlap = [] }
                        p[0]._entity._overlap.push(p)
                        p[1]._entity._overlap.push([p[1], p[0]])

                        if (p[0]._entity._listener && p[0]._entity._listener.overlapStart) p[0]._entity._listener.overlapStart(p[0], p[1])
                        if (p[1]._entity._listener && p[1]._entity._listener.overlapStart) p[1]._entity._listener.overlapStart(p[0], p[1])
                    }
                }
            }
        })
    }

    _narrowPhase(b1: SmallBody, b2: SmallBody, 
                 x1: number, y1: number, x2: number, y2: number, 
                 vx1: number, vy1: number, vx2: number, vy2: number, delta: number): NarrowResult {
        let toix = Infinity, toiy = Infinity
            
        // --  TOI
        if (vx1 != vx2) {
            if (x1 < x2) {
                if(vx1 > vx2 && b1._rightCollide && b2._leftCollide && (!b1._topEntity._rightLower || b1._topEntity._rightLower.otherBody._topEntity != b2._topEntity)) {
                    toix = (x1 - x2 + (b1._width + b2._width) / 2) / (vx2 - vx1)
                }
            } else {
                if(vx1 < vx2 && b2._rightCollide && b1._leftCollide && (!b1._topEntity._leftLower || b1._topEntity._leftLower.otherBody._topEntity != b2._topEntity)) {
                    toix = (x1 - x2 - (b1._width + b2._width) / 2) / (vx2 - vx1)
                }
            }
        }
        
        if (vy1 != vy2) {
            if (y1 < y2) {
                if(vy1 > vy2 && b1._upCollide && b2._downCollide && (!b1._topEntity._upLower || b1._topEntity._upLower.otherBody._topEntity != b2._topEntity)) {
                    toiy = (y1 - y2 + (b1._height + b2._height) / 2) / (vy2 - vy1)
                }
            } else {
                if(vy1 < vy2 && b1._downCollide && b2._upCollide && (!b1._topEntity._downLower || b1._topEntity._downLower.otherBody._topEntity != b2._topEntity)) {
                    toiy = (y1 - y2 - (b1._height + b2._height) / 2) / (vy2 - vy1)
                }
            }
        }

        if(toix > toiy) {
            if(toix < delta && toix > -0.0001) {
                let newy1 = y1 + toix * vy1,
                    newy2 = y2 + toix * vy2

                if(!(newy2 - b2._height/2 + 0.000001 > newy1 + b1._height/2 || newy1 - b1._height/2 + 0.000001 > newy2 + b2._height/2)) {
                    return {
                        time: toix,
                        x: x1 + toix * vx1,
                        y: newy1,

                        body: b1,
                        otherBody: b2,

                        side: x1 < x2 ? 0 : 1
                    }
                }
            } 
            
            if(toiy < delta && toiy > -0.0001) {
                let newx1 = x1 + toiy * vx1,
                    newx2 = x2 + toiy * vx2
                
                if(!(newx2 - b2._width/2 + 0.000001 > newx1 + b1._width/2 || newx1 - b1._width/2 + 0.000001 > newx2 + b2._width/2)) {
                    return {
                        time: toiy,
                        x: newx1,
                        y: y1 + toiy * vy1,

                        body: b1,
                        otherBody: b2,

                        side: y1 < y2 ? 2 : 3
                    }
                }
            } 
        } else {
            if(toiy < delta && toiy > -0.0001) {
                let newx1 = x1 + toiy * vx1,
                    newx2 = x2 + toiy * vx2
                
                if(!(newx2 - b2._width/2 + 0.000001 > newx1 + b1._width/2 || newx1 - b1._width/2 + 0.000001 > newx2 + b2._width/2)) {
                    return {
                        time: toiy,
                        x: newx1,
                        y: y1 + toiy * vy1,

                        body: b1,
                        otherBody: b2,

                        side: y1 < y2 ? 2 : 3
                    }
                }
            } 
            if(toix < delta && toix > -0.0001) {
                let newy1 = y1 + toix * vy1,
                    newy2 = y2 + toix * vy2

                if(!(newy2 - b2._height/2 + 0.000001 > newy1 + b1._height/2 || newy1 - b1._height/2 + 0.000001 > newy2 + b2._height/2)) {
                    return {
                        time: toix,
                        x: x1 + toix * vx1,
                        y: newy1,

                        body: b1,
                        otherBody: b2,

                        side: x1 < x2 ? 0 : 1
                    }
                }
            } 
        }

        return null
    }

    /* returns:
     *  0: no overlap
     *  1: stuck
     *  2: move left
     *  3: move right
     *  4: move up
     *  5: move down
     */
    _solveOverlap(b1: SmallBody, b2: SmallBody, x1: number, y1: number, x2: number, y2: number, 
                  canUp: boolean, canDown: boolean, canLeft: boolean, canRight: boolean): number {
        let up = y1 + b1._height/2 - y2 - b2._height/2,
            down = y2 - b2._height/2 - y1 + b1._height/2,
            left = x2 - b2._width/2 - x1 + b1._width/2,
            right = x1 + b1._width/2 - x2 - b2._width/2,
            yMax = Math.max(up, down), xMax = Math.max(left, right)

        if (yMax <= 0 && xMax <= 0) {
            if (canUp) return 4
            if (canDown) return 5
            if (canLeft) return 2
            if (canRight) return 3
            return 1
        }

        if(yMax > xMax) {
            if(up > down) {
                if(canUp) return 4
            } else {
                if(canDown) return 5
            }
        } else {
            if(left > right) {
                if(canLeft) return 2
            } else {
                if(canRight) return 3
            }
        }
        return 1
    }

    _handleOverlap(ent: Entity, pair: SmallBody[], o1: SmallBody, o2: SmallBody, delta: number) {
        let otherx = o2._topEntity._x + o2._x - delta * o2._topEntity._simvx,
            othery = o2._topEntity._y + o2._y - delta * o2._topEntity._simvy
        
        if (ent._x + o1._x - o1._width/2 + 0.001 <= otherx + o2._width/2 
            && ent._x + o1._x + o1._width/2 >= otherx - o2._width/2 + 0.001
            && ent._y + o1._y - o1._height/2 + 0.001 <= othery + o2._height/2
            && ent._y + o1._y + o1._height/2 >= othery - o2._height/2 + 0.001
            && (o1 instanceof Rect || (o1 as Line)._oneway == 0)
            && (o2 instanceof Rect || (o2 as Line)._oneway == 0) ) {
            switch(this._solveOverlap(
                o1, o2, 
                ent._x + o1._x, ent._y + o1._y, 
                otherx, othery,
                !ent._upLower, !ent._downLower, !ent._leftLower, !ent._rightLower)) {
                case 1: { // stuck
                    if (this._newOverlap) this._newOverlap.push(pair)
                    else this._newOverlap = [pair]
                    this._hasInvalidOverlap = true
                    break
                }
                case 2: { // move left
                    ent._x = otherx - o2._width/2 - o1._width/2 - o1._x
                    if(ent._rightLower) ent._removeRightLowerContact()
                    ent._rightLower = { body: o1, otherBody: o2, side: 0 }
                    if(!o2._higherContacts) o2._higherContacts = []
                    o2._higherContacts.push(ent._rightLower)
                    break
                }
                case 3: { // move right
                    ent._x = otherx + o2._width/2 + o1._width/2 - o1._x
                    if(ent._leftLower) ent._removeLeftLowerContact()
                    ent._leftLower = { body: o1, otherBody: o2, side: 1 }
                    if(!o2._higherContacts) o2._higherContacts = []
                    o2._higherContacts.push(ent._leftLower)
                    break
                }
                case 4: { // move up
                    ent._y = othery + o2._height/2 + o1._height/2 - o1._y
                    if(ent._downLower) ent._removeDownLowerContact()
                    ent._downLower = { body: o1, otherBody: o2, side: 3 }
                    if(!o2._higherContacts) o2._higherContacts = []
                    o2._higherContacts.push(ent._downLower)
                    break
                }
                case 5: { // move down
                    ent._y = othery - o2._height/2 - o1._height/2 - o1._y
                    if(ent._upLower) ent._removeUpLowerContact()
                    ent._upLower = { body: o1, otherBody: o2, side: 2 }
                    if(!o2._higherContacts) o2._higherContacts = []
                    o2._higherContacts.push(ent._upLower)
                    break
                }
            }
        }
    }
}

interface NarrowResult {
    body: Body
    otherBody: Body

    time: number

    x: number
    y: number

    side: number
}