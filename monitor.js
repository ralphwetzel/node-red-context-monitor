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
        console.log("@f", found);
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

        let cc = entry.children;
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

    console.log(found);
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

        scopes.forEach( data => {

            if (!data.key) return;

            // support for complex keys
            // test["mm"].value becomes test.mm.value
            let key = data.key;

            try {
                let key_parts = RED.util.normalisePropertyExpression(key);
                for (i=0; i<key_parts.length; i++) {
                    if (Array.isArray(key_parts[i])) {
                        return;
                    }
                }
                key = key_parts.join('.');
            } catch {
                return;
            }

            if ("." === data.flow) {
                data.flow = node.z;
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

            done();
        });
        node.on("close",function() {
            // remove this nodes ctx(s) from the trigger list
            node.monitoring.forEach( ctx => {
                let sc = set_cache[ctx];
                if (sc) {
                    set_cache[ctx] = sc.filter( n => {
                        return n.id !== node.id;
                    })
                    if (set_cache[ctx].length < 1) {
                        delete set_cache[ctx];
                    }
                }
            })
        });
    }

    RED.nodes.registerType("context-monitor",ContextMonitor);
}
