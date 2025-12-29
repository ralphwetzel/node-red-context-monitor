const fs = require('fs-extra');
const path = require("path");
const util = require("util");

// if (!process.env.NODE_RED_HOME) {
//     let p = require.resolve('node-red');
//     p = path.join(p, '../../../');
//     console.log(p);
// }

process.env.TESTING_CONTEXT_MONITOR = true;

var should = require("should");

// var Context = require("nr-test-utils").require("@node-red/runtime/lib/nodes/context");

// console.log(require.resolve('node-red'));

let Context = require("@node-red/runtime/lib/nodes/context");
const orig_context_get = Context.get;
const orig_get_flow_context = Context.getFlowContext;

// let NR_TEST_UTILS = require("nr-test-utils");
var helper = require("node-red-node-test-helper");

helper.init(require.resolve('node-red'));

var monitorNode = require("../monitor.js");
let monitor = require("../lib/monitor.js");

let changeNode = require("@node-red/nodes/core/function/15-change.js");
let functionNode = require("@node-red/nodes/core/function/10-function.js");
let joinNode = require("@node-red/nodes/core/sequence/17-split.js");

describe('context-monitor Node', function () {

  beforeEach(function (done) {
    // beforeEach
    helper.startServer(done);
  });
  
  afterEach(function (done) {
    // afterEach
    helper.unload().then(function () {
      return Context.clean({ allNodes: {} });
    }).then(function () {
      return Context.close();
    }).then(function () {
      helper.stopServer(done);
    });
  });
  
  function initContext(dont_patch, done) {
  
    if (typeof dont_patch == "function") {
      done = dont_patch;
      dont_patch = false;
    }

    // restoring original functions
    Context.get = orig_context_get
    Context.getFlowContext = orig_get_flow_context;
    
    if (!dont_patch) {
      patch_context();
    }

    Context.init({
      contextStorage: {
        memory0: {
          module: "memory"
        },
        memory1: {
          module: "memory"
        }
      }
    });
    Context.load().then(function () {
      done();
    });
  }

  function patch_context() {
    
    // patching into getContext (exported as 'get')
    Context.get = function (nodeId, flowId) {
      let context = orig_context_get(nodeId, flowId);
      return monitor.create_wrapper(nodeId, flowId, context);
    }

    // patching into getFlowContext
    Context.getFlowContext = function (flowId, parentFlowId) {
      let flow_context = orig_get_flow_context(flowId, parentFlowId);
      return monitor.create_wrapper(flowId, undefined, flow_context);
    }
  
  }

  describe('Node setup', function () {

    it('should be loaded', function (done) {
      var flow = [{ id: "cm1", type: "context-monitor", name: "ctx monitor" }];
      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          cm1.should.have.property('name', 'ctx monitor');
          monitor.trace().should.eql({});
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for global context', function (done) {
      var flow = [{
        id: "cm1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "global",
          key: "test_global"
        }]
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "global:test_global": [
              {
                data: {
                  key: "test_global",
                  scope: "global"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create only one monitor entry for same context keys (single node)', function (done) {
      var flow = [
        {
          id: "cm1",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global"
          }, {
            scope: "global",
            key: "test_global"
          }]
        }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "global:test_global": [
              {
                data: {
                  key: "test_global",
                  scope: "global"
                },
                id: "cm1"
              }, {
                data: {
                  key: "test_global",
                  scope: "global"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create only one monitor entry for same context keys (two nodes)', function (done) {
      var flow = [
        {
          id: "cm1",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global"
          }]
        }, {
          id: "cm2",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global"
          }]
        }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "global:test_global": [
              {
                data: {
                  key: "test_global",
                  scope: "global"
                },
                id: "cm1"
              }, {
                data: {
                  key: "test_global",
                  scope: "global"
                },
                id: "cm2"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create different monitor entries for different context keys (single node)', function (done) {
      var flow = [
        {
          id: "cm1",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global"
          }, {
            scope: "global",
            key: "test_global_2"
          }]
        }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "global:test_global": [{
              data: {
                key: "test_global",
                scope: "global"
              },
              id: "cm1"
            }],
            "global:test_global_2": [{
              data: {
                key: "test_global_2",
                scope: "global"
              },
              id: "cm1"
            }]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create different monitor entries for different context keys (two nodes)', function (done) {
      var flow = [
        {
          id: "cm1",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global"
          }]
        }, {
          id: "cm2",
          type: "context-monitor",
          name: "ctx monitor",
          monitoring: [{
            scope: "global",
            key: "test_global_2"
          }]
        }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "global:test_global": [{
              data: {
                key: "test_global",
                scope: "global"
              },
              id: "cm1"
            }],
            "global:test_global_2": [{
              data: {
                key: "test_global_2",
                scope: "global"
              },
              id: "cm2"
            }]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for flow context', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "flow",
          flow: "f1",
          key: "test_flow"
        }]
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "f1:test_flow": [
              {
                data: {
                  key: "test_flow",
                  scope: "flow",
                  flow: "f1"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for same flow (".") context', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "flow",
          flow: ".",
          key: "test_flow"
        }]
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "f1:test_flow": [
              {
                data: {
                  key: "test_flow",
                  scope: "flow",
                  flow: "f1"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for node context', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "node",
          flow: ".",
          node: "h1",
          key: "test_node"
        }]
      }, {
        id: "h1",
        type: "helper"
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "h1:f1:test_node": [
              {
                data: {
                  scope: "node",
                  flow: "f1",
                  node: "h1",
                  key: "test_node"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for complex node context', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "node",
          flow: ".",
          node: "h1",
          key: "test_node.test_prop"
        }]
      }, {
        id: "h1",
        type: "helper"
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "h1:f1:test_node.test_prop": [
              {
                data: {
                  scope: "node",
                  flow: "f1",
                  node: "h1",
                  key: "test_node.test_prop"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should create monitor entry for complex node context; normalizing context key', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor",
        monitoring: [{
          scope: "node",
          flow: ".",
          node: "h1",
          key: 'test_node["test_prop"]'
        }]
      }, {
        id: "h1",
        type: "helper"
      }];

      helper.load(monitorNode, flow, function () {
        var cm1 = helper.getNode("cm1");
        try {
          monitor.trace().should.eql({
            "h1:f1:test_node.test_prop": [
              {
                data: {
                  scope: "node",
                  flow: "f1",
                  node: "h1",
                  key: "test_node[\"test_prop\"]"
                },
                id: "cm1"
              }
            ]
          });
          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });
  
  describe('Context patch', function () {

    it('should return object of type Proxy for Context.get', function (done) {
      var flow = [{
        id: "cm1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "tested",
            "tot": "str"
          }
        ],
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              let ctx = Context.get("global.test_global");
              util.types.isProxy(ctx).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should return object of type Proxy for Context.getFlowContext', function (done) {
      var flow = [{
        id: "cm1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "tested",
            "tot": "str"
          }
        ],
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              let ctx = Context.getFlowContext();
              util.types.isProxy(ctx).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it("should return object of type Proxy if context stored an object; 'get' by change node = async", function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "{\"prop\":\"value\"}",
            "tot": "json"
          }
        ],
        wires: [["c2"]]
      }, {
        "id": "c2",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "payload",
            "pt": "msg",
            "to": "test_global",
            "tot": "global"
          }
        ],
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");

          h1.on("input", function (msg) {
            try {
              let ctx = msg.payload;
              util.types.isProxy(ctx).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });


    it("should return object of type Proxy if context stored an object; 'get' by function node = sync", function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "{\"prop\":\"value\"}",
            "tot": "json"
          }
        ],
        wires: [["fn1"]]
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "msg.payload = global.get(\"test_global\");\nreturn msg;",
        "outputs": 1,
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode, functionNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");

          h1.on("input", function (msg) {
            try {
              let ctx = msg.payload;
              util.types.isProxy(ctx).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it("should return object of type Proxy for nested object; 'get' by change node = async", function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "{\"prop\":{\"nested\":\"value\"}}",
            "tot": "json"
          }
        ],
        wires: [["c2"]]
      }, {
        "id": "c2",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "payload",
            "pt": "msg",
            "to": "test_global",
            "tot": "global"
          }
        ],
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");

          h1.on("input", function (msg) {
            try {
              let ctx = msg.payload;
              util.types.isProxy(ctx.prop).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it("should return object of type Proxy for nested object; 'get' by function node = sync", function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        name: "ctx monitor"
      }, {
        "id": "c1",
        z: "f1",
        "type": "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "{\"prop\":{\"nested\":\"value\"}}",
            "tot": "json"
          }
        ],
        wires: [["fn1"]]
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "msg.payload = global.get(\"test_global\");\nreturn msg;",
        "outputs": 1,
        wires: [["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode, functionNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");

          h1.on("input", function (msg) {
            try {
              let ctx = msg.payload;
              util.types.isProxy(ctx.prop).should.eql(true);
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });
  });

  describe('Monitoring', function () {

    it('should create (single monitor) set message when global scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "global.set(\"test_global\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "global",
            "key": "test_global"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_global",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "global",
                  key: "test_global"
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) set message when flow scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "flow.set(\"test_flow\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": "f1",
            "key": "test_flow"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_flow",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "flow",
                  flow: "f1",
                  key: "test_flow"
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) set message when node scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "context.set(\"test_node\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_node",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "node",
                  flow: "f1",
                  node: "fn1",
                  key: "test_node"
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) set message when global scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "global",
            "key": "test_global"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_global",
                payload: "value",
                monitoring: {
                  "source": "c1",
                  scope: "global",
                  key: "test_global"
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) set message when flow scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_flow",
            "pt": "flow",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            flow: "f1",
            "key": "test_flow"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_flow",
                payload: "value",
                monitoring: {
                  "source": "c1",
                  scope: "flow",
                  flow: "f1",
                  key: "test_flow"
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) change message when global scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "global.set(\"test_global\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "global",
            "key": "test_global"
          }
        ],
        wires: [[], ["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_global",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "global",
                  key: "test_global",
                  previous: undefined
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) change message when flow scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "flow.set(\"test_flow\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": "f1",
            "key": "test_flow"
          }
        ],
        wires: [[], ["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_flow",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "flow",
                  flow: "f1",
                  key: "test_flow",
                  previous: undefined
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) change message when node scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "context.set(\"test_node\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [[], ["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_node",
                payload: "value",
                monitoring: {
                  "source": "fn1",
                  scope: "node",
                  flow: "f1",
                  node: "fn1",
                  key: "test_node",
                  previous: undefined
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) change message when global scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_global",
            "pt": "global",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "global",
            "key": "test_global"
          }
        ],
        wires: [[], ["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_global",
                payload: "value",
                monitoring: {
                  "source": "c1",
                  scope: "global",
                  key: "test_global",
                  previous: undefined
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should create (single monitor) change message when flow scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_flow",
            "pt": "flow",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            flow: "f1",
            "key": "test_flow"
          }
        ],
        wires: [[], ["h1"]]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql({
                topic: "test_flow",
                payload: "value",
                monitoring: {
                  "source": "c1",
                  scope: "flow",
                  flow: "f1",
                  key: "test_flow",
                  previous: undefined
                }
              })
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should create (two monitors) two set messages when node scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "context.set(\"test_node\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [["j1"], []]
      }, {
        id: "cm2",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [["j1"], []]
      }, {
        "id": "j1",
        "type": "join",
        "z": "f1",
        "mode": "custom",
        "build": "array",
        "property": "",
        "propertyType": "full",
        "key": "topic",
        "count": "2",
        wires: [["h1"]]
    }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode, joinNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              msg.payload.length.should.eql(2);
              msg.topic.should.eql("test_node");
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (two monitors) two set messages when flow scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_flow",
            "pt": "flow",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_flow"
          }
        ],
        wires: [["j1"], []]
      }, {
        id: "cm2",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_flow"
          }
        ],
        wires: [["j1"], []]
      }, {
        "id": "j1",
        "type": "join",
        "z": "f1",
        "mode": "custom",
        "build": "array",
        "property": "",
        "propertyType": "full",
        "key": "topic",
        "count": "2",
        wires: [["h1"]]
    }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode, joinNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              msg.payload.length.should.eql(2);
              msg.topic.should.eql("test_flow");
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });
  
    it('should create (two monitors) two change messages when node scope context is written to by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        "id": "fn1",
        "type": "function",
        "z": "f1",
        "func": "context.set(\"test_node\", \"value\");\nreturn msg;",
        "outputs": 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [[], ["j1"]]
      }, {
        id: "cm2",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "node",
            "flow": ".",
            "node": "fn1",
            "key": "test_node"
          }
        ],
        wires: [[], ["j1"]]
      }, {
        "id": "j1",
        "type": "join",
        "z": "f1",
        "mode": "custom",
        "build": "array",
        "property": "",
        "propertyType": "full",
        "key": "topic",
        "count": "2",
        wires: [["h1"]]
    }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode, joinNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              msg.payload.length.should.eql(2);
              msg.topic.should.eql("test_node");
              done();
            } catch (err) {
              done(err);
            }
          });
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create (two monitors) two change messages when flow scope context is written to by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
            "t": "set",
            "p": "test_flow",
            "pt": "flow",
            "to": "value",
            "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_flow"
          }
        ],
        wires: [[], ["j1"]]
      }, {
        id: "cm2",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_flow"
          }
        ],
        wires: [[], ["j1"]]
      }, {
        "id": "j1",
        "type": "join",
        "z": "f1",
        "mode": "custom",
        "build": "array",
        "property": "",
        "propertyType": "full",
        "key": "topic",
        "count": "2",
        wires: [["h1"]]
    }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode, joinNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");
          h1.on("input", function (msg) {
            try {
              msg.payload.length.should.eql(2);
              msg.topic.should.eql("test_flow");
              done();
            } catch (err) {
              done(err);
            }
          });
          c1.receive({ payload: "" });
        });
      });
    });

    it('should create set message when writing to object reference stored in flow context, by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "fn1",
        type: "function",
        z: "f1",
        func: "let obj = flow.get(\"test_object\");\nobj.prop = \"new\";\nreturn msg;",
        outputs: 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_object"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");

          let cnt = 0;
          let expect = [{
            topic: "test_object",
            payload: { "prop": "value" },
            monitoring: {
              "source": "fn1",
              scope: "flow",
              flow: "f1",
              key: "test_object"
            }
            }, {
              topic: "test_object.prop",
              payload: "new",
              monitoring: {
                "source": "fn1",
                scope: "flow",
                flow: "f1",
                key: "test_object"
              }
            }
          ]
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql(expect[cnt])
              cnt += 1;
              if (cnt >= expect.length) {
                done();
              }
            } catch (err) {
              done(err);
            }
          });
          fn1.context().flow.set("test_object", {"prop": "value"});
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create set message when writing to object reference stored in flow context, complex key, by function node (= sync)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "fn1",
        type: "function",
        z: "f1",
        func: "let obj = flow.get(\"test_object\");\nobj.prop = \"new\";\nreturn msg;",
        outputs: 0
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_object['prop']"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, functionNode], flow, function () {
        initContext(function () {
          let fn1 = helper.getNode("fn1");
          let h1 = helper.getNode("h1");

          let cnt = 0;
          let expect = [
            // {
            // topic: "test_object",
            // payload: { "prop": "value" },
            // monitoring: {
            //   "source": "fn1",
            //   scope: "flow",
            //   flow: "f1",
            //   key: "test_object"
            // }
            // }, 
            {
              topic: "test_object.prop",
              payload: "new",
              monitoring: {
                "source": "fn1",
                scope: "flow",
                flow: "f1",
                key: "test_object['prop']"
              }
            }
          ]
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql(expect[cnt])
              cnt += 1;
              if (cnt >= expect.length) {
                done();
              }
            } catch (err) {
              done(err);
            }
          });
          // this doesn't trigger, as context key references nested property
          fn1.context().flow.set("test_object", {"prop": "value"});
          fn1.receive({ payload: "" });
        });
      });
    });

    it('should create set message when writing to property of object stored in flow context, by change node (= async)', function (done) {
      var flow = [{
        id: "f1",
        type: "tab"
      }, {
        id: "c1",
        z: "f1",
        type: "change",
        "name": "",
        "rules": [
          {
              "t": "set",
              "p": "test_object.prop",
              "pt": "flow",
              "to": "new",
              "tot": "str"
          }
        ]
      }, {
        id: "cm1",
        z: "f1",
        type: "context-monitor",
        monitoring: [
          {
            "scope": "flow",
            "flow": ".",
            "key": "test_object['prop']"
          }
        ],
        wires: [["h1"], []]
      }, {
        id: "h1", type: "helper", wires: []
      }];
      helper.load([monitorNode, changeNode], flow, function () {
        initContext(function () {
          let c1 = helper.getNode("c1");
          let h1 = helper.getNode("h1");

          let cnt = 0;
          let expect = [
            {
              topic: "test_object.prop",
              payload: "new",
              monitoring: {
                "source": "c1",
                scope: "flow",
                flow: "f1",
                key: "test_object['prop']"
              }
            }
          ]
          h1.on("input", function (msg) {
            try {
              delete msg["_msgid"];
              msg.should.eql(expect[cnt])
              cnt += 1;
              if (cnt >= expect.length) {
                done();
              }
            } catch (err) {
              done(err);
            }
          });
          // this doesn't trigger, as context key references nested property
          c1.context().flow.set("test_object", {"prop": "value"});
          c1.receive({ payload: "" });
        });
      });
    });

  });
});