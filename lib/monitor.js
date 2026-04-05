/*
    node-red-context-monitor by @ralphwetzel
    https://github.com/ralphwetzel/node-red-context-monitor
    License: MIT
*/

let RED;
let monitors;

let init = function(_RED, cache) {
    RED = _RED;
    monitors = cache;
}

// This might become a bottleneck if called too often.
// Consider a caching layer - in case it is...
const getOrNull = function(obj, path) {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current == null || !(key in current)) {
      return null; // path does not exist
    }
    current = current[key];
  }

  return current; // path exists → return value (even undefined)
}

// *****
// cache for already wrapped contexts (to avoid multiple wrapping of the same context)
// ATT: to keep the link to the node_id, we need to wrap the same context on a "per node" level, identified by node_id
class WeakMapWithIDs {
    constructor() {
        this.map = new WeakMap();
        this.noIdMap = new WeakMap();
    }

    has(key, node_id) {

        if (!node_id) {
            return this.noIdMap.has(key);
        }
        let obj = this.map.get(key);
        if (obj && node_id in obj) {
            return true;
        }
        return false;
    }

    get(key, node_id) {

        if (!node_id) {
            return this.noIdMap.get(key);
        }
        let obj = this.map.get(key);
        if (obj && node_id in obj) {
            return obj[node_id];
        }
        return undefined;
    }

    set(key, value, node_id) {

        if (!node_id) {
            this.noIdMap.set(key, value);
        } else {
            let obj = this.map.get(key);
            if (!obj) {
                obj = {};
                this.map.set(key, obj);
            }
            obj[node_id] = value;
        }
    }
}  

let proxyCache = new WeakMapWithIDs();

// *****
// methods of arrays that mutate the array itself without using "set"
const mutatingArrayMethods = new Set([
    "push", "pop", "shift", "unshift", "splice", "sort", "reverse"
]);

// *****
// The function to wrap the NR managed context into our monitoring object
// This cant' be done w/ a simple new Proxy(context, handler) as Proxy ensures that immutable functions
// stay immutable - which doesn't support our intentions!

// node_id: The node_id as passed to context.get
// flow_id: The flow_id as passed to context.get
// ctx: the context as managed by Node-RED
// root_id (optional): if global/flow context is re-wrapped, this is the (original) node_id

let create_wrapper = function(node_id, flow_id, ctx, root_id) {

    if (!RED || !monitors) {
        console.log("*** Error while loading node-red-context-monitor:");
        console.log("> Wrapper system not initialized.");
        return ctx;
    }

    let context = ctx;
    
    var context_id = node_id;
    if (flow_id) {
        context_id = node_id + ":" + flow_id;
    }

    let obj = {};

    let wrapper = new Proxy(obj, {

        // *** Those 2 are valid only for function objects

        // apply: function (target, thisArg, argumentsList) {
        //     return Reflect.apply(context, thisArg, argumentsList);
        // },
        // construct: function(target, argumentsList, newTarget) {
        //     return Reflect.construct(context, argumentsList, newTarget)
        // },

        // *** 'defineProperty' must reference the wrapper!

        // defineProperty: function(target, propertyKey, attributes) {
        //     return Reflect.defineProperty(context, propertyKey, attributes);
        // },

        deleteProperty: function(target, propertyKey) {
            return Reflect.deleteProperty(context, propertyKey);
        },
        get: function (target, propertyKey, receiver) {

            if (["set", "get", "keys"].indexOf(propertyKey) > -1) {
                return target[propertyKey];
            } else if (propertyKey == "flow") {
                // create a wrapper for the flow context
                let flow_context = context.flow;
                if (!flow_context) {
                    return;
                }
                
                return proxyCache.has(flow_context, root_id ?? node_id)
                    ? proxyCache.get( flow_context, root_id ?? node_id) 
                    : create_wrapper(flow_id, undefined, flow_context, node_id);

            } else if (propertyKey == "global") {
                // create a wrapper for global context
                let global_context = context.global;
                if (!global_context) {
                    return;
                }
                
                return proxyCache.has(global_context, root_id ?? node_id)
                    ? proxyCache.get(global_context, root_id ?? node_id) 
                    : create_wrapper('global', undefined, global_context, node_id);

            }
            return Reflect.get(context, propertyKey);
        },
        getOwnPropertyDescriptor: function (target, propertyKey) {
            return Reflect.getOwnPropertyDescriptor(context, propertyKey);
        },
        getPrototypeOf: function (target){
            return Reflect.getPrototypeOf(context);
        },
        has: function (target, propertyKey){
            return Reflect.has(context, propertyKey);
        },
        isExtensible: function (target) {
            return Reflect.isExtensible(context);
        },
        ownKeys: function (target) {
            return Reflect.ownKeys(context);
        },
        preventExtensions: function (target) {
            return Reflect.preventExtensions(context);
        },
        set: function (target, propertyKey, value, receiver) {
            return Reflect.set(context, propertyKey, value);
        },
        setPrototypeOf: function (target, prototype) {
            return Reflect.setPrototypeOf(context, prototype)
        }
    });

    Object.defineProperties(wrapper, {
        get: {
            value: function(key, storage, callback) {

                let create_object_wrapper = function(obj, getter_key) {

                    // stop recursion if the value is no object
                    if (obj === null || typeof obj !== 'object') {
                        return obj;
                    }

                    if (proxyCache.has(obj, root_id ?? node_id)) {
                        return proxyCache.get(obj, root_id ?? node_id);
                    }

                    const proxy = new Proxy(obj, {
                        get: (target, property, receiver) => {
                            const getted = Reflect.get(target, property, receiver);

                            if (Array.isArray(target) && mutatingArrayMethods.has(property)) {
                                return (...args) => {
                                    let result, value, previous_value;
                                    
                                    // "property" is the method (e.g. push),
                                    // thus the chain is only build up by the getter_key!
                                    let prop_chain = getter_key ?? "";

                                    switch (property) {
                                        case "push": {
                                            const startIndex = target.length;
                                            result = Array.prototype.push.apply(target, args);

                                            value = new Array(target.length);
                                            
                                            args.forEach((item, i) => {
                                                value[startIndex + i] = item;
                                            });
                                            previous_value = new Array(value.length)
                                            break;
                                        }

                                        case "pop": {
                                            
                                            const length = target.length;

                                            if (length === 0) return undefined;

                                            previous_value = new Array(length);
                                            previous_value[length - 1] = target[length - 1];

                                            value = new Array(length);

                                            result = Array.prototype.pop.apply(target);

                                            break;
                                        }

                                        case "unshift": {
                                            previous_value = target.slice();
                                            result = Array.prototype.unshift.apply(target, args);
                                            value = target;
                                            break;
                                        }

                                        case "shift": {
                                            if (target.length === 0) return undefined;
                                            previous_value = target.slice();
                                            result = Array.prototype.shift.apply(target);
                                            value = target;
                                            break;
                                        }

                                        case "splice": {
                                            let length = target.length;
                                            if (length === 0) return [];

                                            const [start, deleteCount, ...items] = args;

                                            let _start = start;
                                            if (undefined === start) {
                                                _start = 0;
                                            } else if (start > length) {
                                                _start = length;
                                            } else if (start < 0 && start >= -length) {
                                                _start = length + start;
                                            } else if (start < -length) {
                                                _start = 0;
                                            }

                                            let _end = length;
                                            if (deleteCount > 0 && deleteCount === args.length) {
                                                _end = _start + deleteCount;
                                            }

                                            previous_value = new Array(length);
                                            
                                            // fast slice
                                            let i = _start;
                                            while (i < _end) {
                                                previous_value[i] = target[i];
                                                i++;
                                            }

                                            result = Array.prototype.splice.apply(target, args);

                                            value = new Array(target.length);
                                            // fast slice
                                            i = _start;
                                            while (i < _end) {
                                                value[i] = target[i];
                                                i++;
                                            }

                                            break;
                                        }

                                        case "sort":
                                        case "reverse": {
                                            let previous_value = target.slice();
                                            result = Array.prototype[property].apply(target, args);

                                            const value = new Array(target.length);
                                            target.forEach((item, i) => {
                                                if (item !== previous_value[i]) {
                                                    value[i] = item;
                                                } else {
                                                    delete previous_value[i];
                                                }
                                            });
                                            break;
                                        }
                                    }
                                    trigger(root_id ?? node_id, context_id, key, value, previous_value, prop_chain, storage);
                                    
                                    return result;
                                };
                            }

                            let prop_chain = property;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            return create_object_wrapper(getted, prop_chain);
                        },
                        set: (target, propertyKey, value, receiver) => {
                            // this is the monitoring function!
                            let previous_value = target[propertyKey];
                            res = Reflect.set(target, propertyKey, value);

                            let prop_chain = propertyKey;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            trigger(root_id ?? node_id, context_id, key, value, previous_value, prop_chain, storage);
                            return res;
                        },
                        deleteProperty(target, propertyKey) {
                            const oldValue = target[propertyKey];
                            const result = Reflect.deleteProperty(target, propertyKey);

                            let prop_chain = propertyKey;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            if (oldValue !== undefined) {
                                trigger(root_id ?? node_id, context_id, key, undefined, previous_value, prop_chain, storage);
                            }

                            return result;
                        }
                    });

                    proxyCache.set(obj, proxy, root_id ?? node_id);
                    return proxy;

                }

                if (!callback && typeof storage === 'function') {
                    callback = storage;
                    storage = undefined;
                }

                if (callback) {

                    if (typeof callback !== 'function'){
                        throw new Error("Callback must be a function");
                    }

                    let callback_wrapper = function(err, value) {
                        let result = create_object_wrapper(value);
                        callback(err, result);
                    }

                    context.get(key, storage, callback_wrapper);
                    return;
                }

                // be explicit: no (!!) callback here
                let getted_value = context.get(key, storage);
                return create_object_wrapper(getted_value);

            }
        },
        set: {
            value: function(key, value, storage, callback) {

                // this is the monitoring function!
                let previous_value = context.get(key, storage);

                if (!callback && typeof storage === 'function') {
                    callback = storage;
                    storage = undefined;
                }
                if (callback) {

                    if (typeof callback !== 'function'){
                        throw new Error("Callback must be a function");
                    }

                    let callback_wrapper = function(err, res) {
                        // intercept the callback & report success!
                        if (!err) {
                            trigger(root_id ?? node_id, context_id, key, value, previous_value, undefined, storage);
                        }
                        return callback(err, res);
                    }

                    return context.set(key, value, storage, callback_wrapper);
                }

                let res = context.set(key, value, storage);
                trigger(root_id ?? node_id, context_id, key, value, previous_value, undefined, storage);
                return res;
            }
        },
        keys: {
            value: function(storage, callback) {
                return context.keys(storage, callback);
            }
        }
    });

    proxyCache.set(ctx, wrapper, root_id ?? node_id);
    return wrapper;
}

// *****
// The function to trigger the context-monitoring nodes

// root_id: The node.id that wrote to the context
// context_id: The context (id) that was written to
// key: The key (in context) that ws written to
// new_value: The value written
// previous_value: The value over-written
// prop_chain: In case the context is a (nested) object, the sequence of property keys.

let trigger = function(root_id, context_id, key, new_value, previous_value, prop_chain, storage) {

    function trigger_receivers(monitoring_nodes, message) {

        monitoring_nodes.forEach(node => {

            if ("_kids" === node.id) return; // this is the internal marker to manage the tree structure - no trigger!

            let n = RED.nodes.getNode(node.id);
            if (n) {

                let msg = RED.util.cloneMessage(message);

                msg.monitoring = {
                    "scope": node.data.scope,
                    "source": root_id
                }

                switch (node.data.scope) {
                    case "node":
                        msg.monitoring.node = node.data.node;
                    case "flow":
                        msg.monitoring.flow = node.data.flow;
                    case "global":
                        let parts = RED.util.parseContextStore(node.data.key);
                        msg.monitoring.key = parts.key;
                        if (parts.store) {
                            msg.monitoring.store = parts.store;
                        }
                }

                n.receive(msg);    
            }    
        });
    }

    let kc = key;
    if (prop_chain?.length) {
        kc += "." + prop_chain;
    }

    let keys = [];
    try {
        keys = RED.util.normalisePropertyExpression(kc);
    } catch {
        return; // invalid key - no trigger
    }
    
    for (let i=keys.length; i>0; i--) {

        let cidk = context_id + ":" + keys.slice(0,i).join(".");

        if (storage && storage !== RED.settings.context?.default) {
            cidk = storage + "://" + cidk;
        }

        let mons = monitors[cidk] ?? [];

        if (mons.length) {
            let msg = {
                topic: kc,
                payload: new_value,
                previous: previous_value,

                // ATT: by design this does no deepCompare!
                changed: new_value != previous_value
            }

            trigger_receivers(mons, msg);    
        }
    }

    if ("object" === typeof new_value) {
        // trigger all nodes monitoring properties inside of the object set to the context
        // kids: array of property id's of "monitors" entries
        const trigger_kids = function(parent_id, kids, new_value, previous_value, key_chain) {

            // walk through the tree structure
            kids.forEach(kid => {

                // none is monitoring - no action!
                let mon = monitors[kid];
                if (!mon) return;

                let key = kid.slice(parent_id.length + 1); // the "." between parent_id & the rest of the key

                let nv = getOrNull(new_value, key);
                let pv = getOrNull(previous_value, key);

                if (null === nv && null === pv) return; // path neither exists in new_value nor in previous_value → no trigger

                let kc = key_chain + "." + key;
                msg = {
                    topic: kc,
                    payload: nv,
                    previous: pv,

                    // ATT: by design this does no deepCompare!
                    changed: nv != pv
                }

                trigger_receivers(mon, msg);

                // recursive trigger for the next level of nesting
                
                if ("object" === typeof nv) {
                    let _nextKids = monitors[kid]?.find(n => n.id == "_kids")?.data ?? [];
                    trigger_kids(kid, _nextKids, nv, pv, kc);
                }

            });
        }

        // find entry points for downstream monitoring nodes
        let search_id = context_id + ":" + keys.join(".");

        if (storage && storage !== RED.settings.context?.default) {
            search_id = storage + "://" + search_id;
        }

        let _length = 0;
        let _kids = [];

        if (search_id in monitors) {
            // if there are monitoring nodes for nested properties, the entry point is the current key itself
            // it might yet be that it has no kids => no downstream monitors.
            _kids = monitors[search_id].find(n => n.id == "_kids")?.data ?? [];
        } else {
            // we create our own (virtual) list of  kids!
            // => find the closest (downstream) entry in the monitors list
            // ATT: there might be more than one entry of the same length / on the same level!
            for (let mon in monitors) {
                if (mon.startsWith(search_id)) {
                    if (!_length || mon.length < _length) {
                        _kids = [mon];
                        _length = mon.length;
                    } else if (mon.length === _length) {
                        _kids.push(mon);
                    }
                }
            }
        }

        trigger_kids(
            search_id,
            _kids,
            new_value, 
            previous_value, 
            kc
        );

    }

}

// End: The function ....
// *****

module.exports = {
    init: init,
    create_wrapper: create_wrapper
}

if (process.env.TESTING_CONTEXT_MONITOR) {

    module.exports["trace"] = function(id) {

        if (!RED || !monitors) {
            console.log("*** Error while testing node-red-context-monitor:");
            console.log("> Wrapper system not initialized.");
            return;
        }
    
        if (id) {
            return monitors[id];
        }
        return monitors;
    }
}

