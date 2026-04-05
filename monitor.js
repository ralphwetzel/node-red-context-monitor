/*
    node-red-context-monitor by @ralphwetzel
    https://github.com/ralphwetzel/node-red-context-monitor
    License: MIT
*/

const fs = require('fs-extra');
const path = require("path");
const monitor = require('./lib/monitor.js');

// this used to be the cache of ctx triggered @ set
// ... that's why it's the set_cache! 
let set_cache = {};

// *****
// Patch support: Scan the require database for the path to a to-be-required file

let require_cache = {
    ".": require.main
}

function scan_for_require_path(req_path) {

    let found;

    if (process.env.NODE_RED_HOME) {
        found = path.join(process.env.NODE_RED_HOME, "..", req_path);
        if (fs.existsSync(found)) {
            return found;
        }
    }

    let runner = 0;

    while (runner < Object.keys(require_cache).length) {

        let key = Object.keys(require_cache)[runner];
        let entry = require_cache[key];

        if (entry.id?.includes(req_path)) {
            found = entry.id;
            break;
        }

        let cc = entry.children ?? [];
        cc.forEach(c => {
            if (!(c.id in require_cache)) {
                require_cache[c.id] = c;
            }
        });
    
        runner += 1;
    }

    if (found) {
        if (!fs.existsSync(found)) {
            console.log("*** Error while loading node-red-context-monitor:")
            console.log("Failed to calculate path to required file.");
            console.log("Please raise an issue @ our GitHub repository, stating the following information:");
            console.log("> scanned for:", req_path);
            console.log("> found:", found);
            return;
        }
    }

    return found;
}

// End: "Patch support ..."
// *****

// *****
// Make available & patch the Context Manager

let context_manager;

// When running a test, NODE_RED_HOME is not defined.
if (process.env.NODE_RED_HOME && !process.env.TESTING_CONTEXT_MONITOR) {

    let context_manager_path = scan_for_require_path("@node-red/runtime/lib/nodes/context");
    if (context_manager_path) {

        context_manager = require(context_manager_path);
    
        // patching into getContext (exported as 'get')
        const orig_context_get = context_manager.get;
        context_manager.get = function(nodeId, flowId) {
            let context = orig_context_get(nodeId, flowId);
            return monitor.create_wrapper(nodeId, flowId, context);
        }
    
        // patching into getFlowContext
        const orig_get_flow_context = context_manager.getFlowContext;
        context_manager.getFlowContext = function(flowId, parentFlowId) {
            let flow_context = orig_get_flow_context(flowId, parentFlowId);
            return monitor.create_wrapper(flowId, undefined, flow_context);
        }
    
    }
}

// End: "Make available ..."
// *****

// *****
// Postprocessing of the set_cache:
// Identify the "kids" of each entry, i.e. the entries that are more specific (have more key parts) but share the same prefix.
// Create a tree like structure to walk through if the value set to the context is an object!

function create_kids() {

    for (const c in set_cache) {

        let kids = [];
        let depth = 0;
        const cc = c.split(".");

        for (const entry in set_cache) {
            const ee = entry.split(".");

            const lcc = cc.length;
            const lee = ee.length;

            if (lee > lcc && ee.slice(0, lcc).join(".") == cc.join(".")) {
                let d = lee - lcc;

                // init depth with the first found entry
                if (!depth) {
                    depth = d;
                }

                // if depth is already set, only consider entries with the same or less depth
                if (d > depth) continue;

                // if we found an entry with less depth, reset the kids list & update the depth
                if (depth < d) {
                    depth = d;
                    kids = [];
                }

                kids.push(entry);
            }
        }

        // insert, append or remove the _kids data ...
        // ... and prevent holes in the set_cache[c] array!
        const index = set_cache[c].findIndex(n => n.id == "_kids");

        if (kids.length > 0) {

            let newKids = {
                "id": "_kids",
                "data": kids
            }

            if (index < 0) {
                // new kids
                set_cache[c].push(newKids);
            } else {
                // replace kids
                set_cache[c][index] = newKids;
            }
        } else {
            // no kids, remove the _kids entry if exists
            if (index > -1) set_cache[c].splice(index, 1);
        }
    }

};

// *****
// node-red-context-monitor

module.exports = function(RED) {

    // Catch RED here & provide it to the monitor!
    // It's necessary for trigger function to map node_id -> node object.
    monitor.init(RED, set_cache);

    function ContextMonitor(config) {
        RED.nodes.createNode(this,config);
        var node = this;

        let scopes = config.monitoring ?? [];
        node.data = scopes;

        node.monitoring = [];

        let nodes = {};
        let flows = {}

        // collect all known flows & nodes
        RED.nodes.eachNode( n => {
            if (n.id) {
                nodes[n.id] ??= true;
            }
            if (n.z) {
                flows[n.z] ??= true;
            }
        });

        scopes.forEach( data => {

            if (data.key && "string" === typeof data.key && data.key.length<1) return;

            // Let's validate the given monitoring context first...
            switch (data.scope) {
                case "node": {
                    if (!data.node || "." == data.node || data.node.length < 1) {
                        node.warn('Scope is "Node" but node reference is missing.');
                        return;
                    }
                    if (!nodes[data.node]) {
                        node.warn('Referenced node does not exist.');
                        return;
                    }
                }
                case "flow": {
                    if (!flows[data.flow]) {
                        if ("." !== data.flow) {
                            node.warn('Referenced flow does not exist.');
                            return;
                        }
                    }
                }
                default: {
                    if (!data.key || data.key.length < 1) {
                        node.warn("Monitoring context key is missing.")
                        return;
                    }
                }
            }

            if ("." === data.flow) {
                data.flow = node.z;
            }

            // split the store from the key
            let parts = RED.util.parseContextStore(data.key);
            let key = parts.key;
            let store = parts.store;

            // resolve $parent to true flow id ... if the monitor sits in a subflow!
            if ("flow" == data.scope && key.startsWith("$parent.")) {
                let fl = RED.nodes.getNode(data.flow);
                if ("subflow" == fl?.TYPE) {
                    // This might not create the expected result, if .parent is not a flow!
                    // ... but a group or another subflow!
                    // >> Fix it if someone asks for.
                    data.flow = fl.parent.id;
                    data.key = key = key.substring("$parent.".length);
                }
            }

            // support for complex keys
            // test["mm"].value becomes test.mm.value
            try {
                let key_parts = RED.util.normalisePropertyExpression(key);
                // It's the job of the editor ui to ensure keys are valid!
                // Thus this shall never happen; in consequence, it's ok to silenty return here.
                for (i=0; i<key_parts.length; i++) {
                    if (Array.isArray(key_parts[i])) {
                        return;
                    }
                }
                key = key_parts.join('.');
            } catch (err) {
                node.warn(`Failed to parse context reference definition '${key}': ${err.message}`)
                return;
            }

            let ctx = "global";
            switch (data.scope) {
                case "global":
                    ctx = `global:${key}`;
                    break;
                case "flow":
                    ctx = `${data.flow}:${key}`;
                    break;
                case "node":
                    ctx = `${data.node}:${data.flow}:${key}`;
                    break;
                default:
                    return;
            }

            if (store) {
                ctx = `${store}://${ctx}`;
            }

            node.monitoring.push(ctx);

            if (!set_cache[ctx]) {
                set_cache[ctx] = [];
            }

            set_cache[ctx].push({
                "id": node.id,
                "data": data,
            });
        });

        // Postprocessing of the set_cache:
        // Identify the "kids" of each entry, i.e. the entries that are more specific (have more key parts) but share the same prefix.
        // Create a tree like structure to walk through if the value set to the context is an object!
        create_kids();

        node.on("input", function(msg, send, done) {
            
            let node = this;
            let timeout;

            // unfold & check if changed
            let prev = msg.previous;
            let changed = msg.changed;
            delete msg.previous;
            delete msg.changed;

            if (changed) {
                // if changed, clone & emit @ second output terminal
                let m = RED.util.cloneMessage(msg);
                delete m._msgid;
                m.monitoring.previous = prev;
                send([msg, m]);
            } else {
                // just report set
                send([msg, null]);
            }

            if (config.tostatus) {

                if (timeout) {
                    clearTimeout(timeout);
                }
    
                node.status({
                    fill: "blue",
                    shape: changed ? "dot" : "ring", 
                    text: msg.topic + ": " + JSON.stringify(msg.payload)
                });
    
                timeout = setTimeout(function() {
                    node.status({});
                    timeout = undefined;
                }, 2500);    
            }

            done();
        });

        node.on("close",function() {
            // remove this nodes ctx(s) from the trigger list
            node.monitoring.forEach( ctx => {
                let sc = set_cache[ctx];
                if (sc) {
                    set_cache[ctx] = sc.filter( n => {
                        return n.id !== node.id;
                    });

                    if (set_cache[ctx].length === 0) {
                        delete set_cache[ctx];
                    } else if (set_cache[ctx].length === 1 && set_cache[ctx][0]?.id == "_kids") {
                        delete set_cache[ctx];
                    }
                }
            });
            
            // re-process the tree structure!
            // console.log("Re-processing tree structure @ close...");
            create_kids();

            if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
            }
        });
    }

    RED.nodes.registerType("context-monitor",ContextMonitor);
}
