node-red-contrib-mios
=====================

Node-RED nodes to get events from and control your MIOS/Vera unit. 

Updated to force jSON response 

## Install

Run the following command in your Node-RED user directory - typically `~/.node-red`:

```
npm install node-red-contrib-mios
```


## Usage

Get events from your MIOS/Vera unit and control items in the same.

Incoming events can be filtered so you can use one mios-in node for all events, events from one room or a specific item. The value from the events is stored in `msg.payload`

To set items you send the value in `msg.payload` and use the mios-out node to specify the item, ie `Bedroom:Bed Light:Status`, or define the item in `msg.topic`.

