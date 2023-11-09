# @ralphwetzel/node-red-context-monitor

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/preview.png"
    style="min-width: 250px; width: 250px; align: center; border: 1px solid lightgray;"/>

A [Node-RED](https://www.nodered.org) node to monitor a [context](https://nodered.org/docs/user-guide/context).

### What it does

This node allows to setup the reference to a context, then sends a message when this context is written to.

It sends a dedicated message on a separate port in case it detects that the value of the context was changed.

The message sent will carry the current value of the context as `msg.payload`, the context key as `msg.topic`.

Monitoring details will be provided as `msg.monitoring`:
* The monitoring setup: `scope` & `key` always, `flow` (id) / `node` (id) if applicable.
* The id of the node that wrote to the context as `source`.

The message sent off the change port carries an additional property in `msg.monitoring`:
* The value overwritten as `previous`.

It is possible to monitor an infinite number of contexts with each instance of this node.

This node supports the three [context scope levels](https://nodered.org/docs/user-guide/context#context-scopes) `Global`, `Flow` & `Node`.

### Installation

Use the Node-RED palette manager to install this node.

### Details

To monitor a `Global` scope context, set the scope to `Global` and provide the context key.

<img alt="global" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/global.png"
    style="min-width: 474px; width: 474px; align: center; border: 1px solid lightgray;"/>

To monitor a `Flow` scope context, set the scope to `Flow`, then select the owning flow and provide the context key.

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/flow.png"
    style="min-width: 474px; width: 474px; align: center; border: 1px solid lightgray;"/>

To monitor a `Node` scope context, set the scope to `Node`, then select flow & node and provide the context key.

<img alt="node" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/node.png"
    style="min-width: 474px; width: 474px; align: center; border: 1px solid lightgray;"/>

> Hint: This node doesn't create a context. It just tries to reference to those already existing. If you're referencing a non-existing context, no harm will happen.

### Monitoring objects stored in context
You may of course define a setup that monitors objects stored in context.

If you create a reference to this object (stored in context) and write to its properties, this node issues its messages accordingly.

> Disclaimer: Monitoring changes to elements of an `Array` currently is not supported.

#### Example:
Monitoring context definition:

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/object_monitor.png"
    style="min-width: 474px; width: 474px; align: center; border: 1px solid lightgray;"/>

Code in a `function` node:

``` javascript
    // suppose, test_flow = { prop: "value" }

    let obj = flow.get("test_flow");
    obj.prop = "new";
```

Message sent by the node:

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/object_msg.png"
    style="min-width: 310px; width: 310px; align: center; border: 1px solid lightgray;"/>

#### Object property monitoring
You may define a setup that doesn't monitor the (whole) object, but only one of its properties:

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/object_prop.png"
    style="min-width: 474px; width: 474px; align: center; border: 1px solid lightgray;"/>

Such a monitor will react _only_, when this property and - if it's an object - its child properties are written to.