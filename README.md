# @ralphwetzel/node-red-context-monitor

<img alt="flow" src="https://raw.githubusercontent.com/ralphwetzel/node-red-context-monitor/main/resources/preview.png"
    style="min-width: 250px; width: 250px; align: center; border: 1px solid lightgray;"/>

A [Node-RED](https://www.nodered.org) node to monitor a [context](https://nodered.org/docs/user-guide/context).
    
This node allows to setup the reference to a context, then sends a message when this context is written to.

It sends a dedicated message on a separate port in case it detects that the value of the context was changed.

The message sent will carry the current value of the context as `msg.payload`. Monitoring details will be provided as `msg.monitoring`.

It is possible to monitor an infinite number of context variables with each instance of this node.

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