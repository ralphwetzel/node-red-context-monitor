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
                return create_wrapper(flow_id, undefined, flow_context, node_id);
            } else if (propertyKey == "global") {
                // create a wrapper for global context
                let global_context = context.global;
                if (!global_context) {
                    return;
                }
                return create_wrapper('global', undefined, global_context, node_id);
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

                let create_object_wrapper = function(object, getter_key) {

                    let handler = {
                        get: (target, property, receiver) => {
                            const getted = Reflect.get(target, property, receiver);

                            let prop_chain = property;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            if (Array.isArray(target) && mutatingArrayMethods.includes(property)) {
                                return (...args) => {
                                    let result, value, previous_value;

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
                                    // console.log("mutating array method trigger: ", root_id ?? node_id, context_id, key, value, previous_value, prop_chain); 
                                    trigger(root_id ?? node_id, context_id, key, undefined, previous_value, prop_chain);
                                    
                                    return result;
                                };
                            }

                            return create_object_wrapper(getted, prop_chain);
                        },
                        set: (target, propertyKey, value, receiver) => {
                            // this is the monitoring function!
                            let previous_value = Reflect.get(object, propertyKey);
                            res = Reflect.set(object, propertyKey, value);

                            let prop_chain = propertyKey;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            trigger(root_id ?? node_id, context_id, key, value, previous_value, prop_chain);
                            return res;
                        }
                    };

                    return new Proxy(object, handler);

                }

                let create_array_wrapper = function(object, getter_key) {

                    let handler = {
                        get: (target, property, receiver) => {
                            let getted = Reflect.get(object, property);

                            if (
                                typeof getted === 'object' &&
                                Array.isArray(getted)
                            ) { 
                                let prop_chain = property;
                                if (getter_key?.length) {
                                    prop_chain = getter_key + "." + prop_chain;
                                }
                                return create_object_wrapper(getted, prop_chain);
                            }
                            return getted;
                        },
                        set: function(target, propertyKey, value, receiver) {
                            // this is the monitoring function!
                            let previous_value = Reflect.get(object, propertyKey);
                            res = Reflect.set(object, propertyKey, value);

                            let prop_chain = propertyKey;
                            if (getter_key?.length) {
                                prop_chain = getter_key + "." + prop_chain;
                            }

                            trigger(root_id ?? node_id, context_id, key, value, previous_value, prop_chain);
                            return res;
                        }
                    };

                    return new Proxy(object, handler);

                }

                let apply_wrapper = function (getted) {
                    if (
                        typeof getted === 'object' &&
                        !Array.isArray(getted) &&
                        getted !== null
                    ) { 
                        return create_object_wrapper(getted);
                    }
                    return getted;
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
                        let result = apply_wrapper(value);
                        callback(err, result);
                    }

                    context.get(key, storage, callback_wrapper);
                    return;
                }

                // be explicit: no (!!) callback here
                let getted_value = context.get(key, storage);
                return apply_wrapper(getted_value);

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
                            trigger(root_id ?? node_id, context_id, key, value, previous_value);
                        }
                        return callback(err, res);
                    }

                    return context.set(key, value, storage, callback_wrapper);
                }

                let res = context.set(key, value, storage);
                trigger(root_id ?? node_id, context_id, key, value, previous_value);
                return res;
            }
        },
        keys: {
            value: function(storage, callback) {
                return context.keys(storage, callback);
            }
        }
    });

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

let trigger = function(root_id, context_id, key, new_value, previous_value, prop_chain) {

    function trigger_receivers(monitoring_nodes, message) {
        monitoring_nodes.forEach(node => {
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
                        msg.monitoring.key = node.data.key;
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
        let mons = monitors[cidk]?.nodes ?? [];
        
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
        const trigger_kids = function(parent_id, new_value, previous_value, key_chain) {

            // walk through the tree structure
            monitors[parent_id]?.next?.forEach(kid => {

                // none is monitoring - no action!
                let mon = monitors[kid];
                if (!mon) return;

                let key = kid.slice(parent_id.length + 1); // the "." between parent_id & the rest of the key
                console.log("key: ", key);
                console.log("new_value: ", new_value);
                console.log(getOrNull(new_value, key));

                let nv = getOrNull(new_value, key);
                let pv = getOrNull(previous_value, key) ?? undefined

                if (null === nv) return; // path does not exist in new_value → no trigger

                console.log("found key: ", key, " in new_value: ", new_value);

                let kc = key_chain + "." + key;
                msg = {
                    topic: kc,
                    payload: nv,
                    previous: pv,

                    // ATT: by design this does no deepCompare!
                    changed: nv != pv
                }

                console.log(mon.nodes, " -> trigger: ", msg);

                trigger_receivers(mon.nodes, msg);

                // recursive trigger for the next level of nesting
                console.log("nv: ", nv);
                
                if ("object" === typeof nv) {
                    trigger_kids(kid, nv, pv, kc);
                }

            });
        }

        trigger_kids(
            context_id + ":" + keys.join("."),
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

