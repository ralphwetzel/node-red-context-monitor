/*
    node-red-context-monitor by @ralphwetzel
    https://github.com/ralphwetzel/node-red-context-monitor
    License: MIT
*/

const fs = require('fs-extra');
const os = require("os");
const path = require("path");

let error_header = "*** Error while loading node-red-context-monitor:";

// this used to be the cache of ctx triggered @ set
// ... that's why it's the set_cache! 
let set_cache = {};

let _RED;

// ****
// Copied from node-red-mcu-plugin:
// Patch support function: Calculate the path to a to-be-required file

function get_require_path(req_path) {

    let rm = require.main.path;

    try {
        let stat = fs.lstatSync(rm);
        if (!stat.isDirectory()) {
            console.log(error_header);
            console.log("require.main.path is not a directory.");
            return;
        }
    } catch (err) {
        console.log(err);
        console.log(error_header);
        if (err.code == 'ENOENT') {
            console.log("require.main.path not found.");
        } else {
            console.log("Error while handling require.main.path.")
        }
        return null;
    }

    // split path into segments ... the safe way
    rm = path.normalize(rm);
    let rms = []
    let rmp;
    do {
        rmp = path.parse(rm);
        if (rmp.base.length > 0) {
            rms.unshift(rmp.base);
            rm = rmp.dir;    
        }
    } while (rmp.base.length > 0)

    let rmsl = rms.length;

    if (rms.includes("packages"))  {
        if (rms[rmsl-3]=="packages" && rms[rmsl-2]=="node_modules" && rms[rmsl-1]=="node-red") {
            // dev:     [...]/node-red/packages/node_modules/node-red
            // install: [...]/lib/node_modules/node-red
            // pi:      /lib/node_modules/node-red/

            // dev:     [...]/node-red/packages/node_modules/@node-red
            // install: [...]/lib/node_modules/node-red/node_modules/@node-red
            // pi:      /lib/node_modules/node-red/node_modules/@node-red
            rms.splice(-2);
        }
    }

    // compose things again...
    req_path = req_path.split("/");
    let p = path.join(rmp.root, ...rms, ...req_path);

    if (!fs.existsSync(p)) {
        console.log(error_header)
        console.log("Failed to calculate correct patch path.");
        console.log("Please raise an issue @ our GitHub repository, stating the following information:");
        console.log("> require.main.path:", require.main.path);
        console.log("> utils.js:", p);
        return null;
    }

    return p;
}

// End: "Patch support ..."
// *****

// *****
// Make available the Context Manager

const context_manager_path = get_require_path("node_modules/@node-red/runtime/lib/nodes/context/index.js");
if (!context_manager_path) return;
const context_manager = require(context_manager_path);

// The function to wrap the NR managed context into our monitoring object
// This cant' be done w/ a simple new Proxy(context, handler) as Proxy ensures that immutable functions
// stay immutable - which doesn't support our intentions!

let create_wrapper = function(node_id, flow_id, ctx) {

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
                return create_wrapper(flow_id, undefined, flow_context);
            } else if (propertyKey == "global") {
                // create a wrapper for global context
                let global_context = context.global;
                if (!global_context) {
                    return;
                }
                return create_wrapper('global', undefined, global_context);
            }
            return Reflect.get(context, propertyKey, receiver);
        },
        getOwnPropertyDescriptor: function (target, propertyKey) {
            return Reflect.getOwnPropertyDescriptor(context, propertyKey);
        },
        getPrototypeOf: function (target){
            Reflect.getPrototypeOf(context);
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
            return Reflect.set(context, propertyKey, value, receiver);
        },
        setPrototypeOf: function (target, prototype) {
            return Reflect.setPrototypeOf(context, prototype)
        }
    });

    const IDENTITY = Symbol('proxy_target_identity')

    Object.defineProperties(wrapper, {
        get: {
            value: function(key, storage, callback) {
                let gettedValue = context.get(key, storage, callback);
            debugger
                let handler = {
                    get: (target, property, receiver) => {
                        // See https://discourse.nodered.org/t/node-red-context-monitor-a-node-to-monitor-a-node-red-context/82555/8?u=bartbutenaers
                        if (property === IDENTITY) {
                            return target
                        }
                        return Reflect.get(target, property, receiver)
                    },
                    set: function(obj, property, value) {
                        let previous_value = Object.assign({}, obj);
                        obj[property] = value;;
                        trigger(context_id + ":" + key, obj, previous_value);
                        return true;
                    }
                };

                return new Proxy(gettedValue, handler);
            }
        },
        set: {
            value: function(key, value, storage, callback) {
                debugger
                
                if (value[IDENTITY]) {
                    // Get the original target value
                    value = value[IDENTITY];
                }

                // this is the monitoring function!
                let previous_value = context.get(key, storage);
                let res = context.set(key, value, storage, callback);
                trigger(context_id + ":" + key, value, previous_value);
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

let trigger = function(context_key_id, new_value, previous_value) {

    function trigger_receivers(cache, message) {
        cache.forEach(node => {
            let n = _RED.nodes.getNode(node.id);
            if (n) {

                let msg = _RED.util.cloneMessage(message);

                msg.topic = node.data.key;
                msg.monitoring = {
                    "scope": node.data.scope,
                }

                switch (node.data.scope) {
                    case "global":
                        msg.monitoring.key = node.data.key;
                        break;
                    case "flow":
                        msg.monitoring.flow = node.data.flow;
                        msg.monitoring.key = node.data.key;
                        break;
                    case "node":
                        msg.monitoring.flow = node.data.flow;
                        msg.monitoring.node = node.data.node;
                        msg.monitoring.key = node.data.key;
                        break;
                }

                n.receive(msg);    
            }    
        });
    }

    let cache = set_cache[context_key_id] ?? [];
    let msg = {
        payload: new_value,
        previous: previous_value
    }
    trigger_receivers(cache, msg);

    // if (new_value !== previous_value) {
    //     let cache = change_cache[context_key_id] ?? [];
    //     let msg = {
    //         payload: new_value,
    //         previous: previous_value
    //     }
    //     trigger_receivers(cache, msg);
    // }
}

// End: The function ....
// *****

// patching into getContext (exported as 'get')
const orig_context_get = context_manager.get;
context_manager.get = function(nodeId, flowId) {
    let context = orig_context_get(nodeId, flowId);
    return create_wrapper(nodeId, flowId, context);
}

// patching into getFlowContext
const orig_get_flow_context = context_manager.getFlowContext;
context_manager.getFlowContext = function(flowId, parentFlowId) {
    let flow_context = orig_get_flow_context(flowId, parentFlowId);
    return create_wrapper(flowId, undefined, flow_context);
}

// End: "Make available ..."
// *****

// *****
// node-red-context-monitor

module.exports = function(RED) {

    // catch this here!
    // necessary for trigger function to map node_id -> node object.
    _RED = RED;

    function ContextMonitor(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        node.data = config.monitoring;
        node.monitoring = [];

        config.monitoring.forEach( data => {

            if (!data.key) return;

            let ctx = "global";
            switch (data.scope) {
                case "global":
                    ctx = `global:${data.key}`;
                    break;
                case "flow":
                    ctx = `${data.flow}:${data.key}`;
                    break;
                case "node":
                    ctx = `${data.node}:${data.flow}:${data.key}`;
                    break;
                default:
                    return;
            }

            node.monitoring.push(ctx);

            if (!set_cache[ctx]) {
                set_cache[ctx] = [];
            }

            set_cache[ctx].push({
                "id": node.id,
                "data": data
            });
        })

        node.on("input", function(msg, send, done) {
            
            // unfold & check if changed
            let prev = msg.previous;
            delete msg.previous;

            if (msg.payload !== prev) {
                // if changed, clone & emit @ second output terminal
                let m = RED.util.cloneMessage(msg);
                delete m._msgid;
                m.monitoring.previous = prev;
                send([msg, m]);
            } else {
                // just report set
                send([msg, null]);
            }

            done();
        });
        node.on("close",function() {
            // remove this nodes ctx(s) from the trigger list
            node.monitoring.forEach( ctx => {
                set_cache[ctx] = set_cache[ctx].filter( n => {
                    return n.id !== node.id;
                })
            })
        });
    }

    RED.nodes.registerType("context-monitor",ContextMonitor);
}
