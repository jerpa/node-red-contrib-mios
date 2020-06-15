module.exports = function(RED) {
  function MiosServer(config) {
    // this node collects all the data from the uPnP server
    // it stores the data version number
    // then it asks for new data since the data version number at the frequency set by the user
    RED.nodes.createNode(this, config);
    var node=this; 
    node.name=config.name;
    node.host=config.host;
    node.port=(config.port?config.port:3480);
    // GET mios url every X ms; added to config panel to help when Z-Wave controller bogs down
    // timer when connected
    node.frequency=(config.frequency?config.frequency:200); // 200 ms is what it takes to make a lightswitch feel responsive
    // current timer
    node.timer = node.frequency;
    // not necessary -- explicitly added to urls
    //node.getjson = "&output_format=json";
    node.loadtime=0;
    node.dataversion=0;
    node.items=[];
    node.subscribers=[];
    node.devices=[];
    node.rooms=[];
    node.active=true;

    node.updateConnected=function(connected) {
      // check every 10 sec if not connected
      node.timer=(connected?node.frequency:10000); 
      // loop through subscribers
      for (var id in node.subscribers) {
        if (node.subscribers.hasOwnProperty(id)) {
          node.subscribers[id].node.updateConnected(connected);
        }
      }
    };

    node.loadUrl=function(url,callback) {
      // unnecessary -- reused existing variable
      // var result;
      // url given?
      if (url) {
        var http=require("http");
        http.get(url,function(res) {
          var data="";

          res.on("data",function(d) {
            data+=d;
          });

          res.on("end",function() {
            try {
              data=JSON.parse(data);
            } catch (e) {
              callback(RED._("mios.error.invalid-json"), null);
              return;
            }

            node.updateConnected(true);
            callback(null, data);
            return;
          });

        }).on("error",function(e) {
          node.updateConnected(false);
          callback(e, null);
          return;
        });
      } else {
        callback(RED._("mios.error.invalid-url"), null);
      }
    };

    node.initItems=function() {
      node.loadUrl("http://"+node.host+":"+node.port+"/data_request?id=user_data&output_format=json",function(err, result) {
        if (err!==null) {
          node.error(err);
        } else {
          // unnecessary -- already declared
          // node.items=[];
          // node.rooms=[];
          // node.devices=[];
          node.loadtime=result.LoadTime;
          node.dataversion=result.DataVersion;
          // 0 is unknown room
          node.rooms[0]={name:"Unknown",id:0};
          // loop through rooms
          for (var room=0;room<result.rooms.length;room++) {
            // collect room name
            node.rooms[result.rooms[room].id]={name:result.rooms[room].name,id:result.rooms[room].id};
          }
          // loop through devices
          for (var dev=0;dev<result.devices.length;dev++) {
            // room is defined?
            if (typeof(result.devices[dev].room)!="undefined") {
              // collect device name
              node.devices[result.devices[dev].id]=node.rooms[result.devices[dev].room].name+":"+result.devices[dev].name;
              // loop through tates
              for (var sta=0;sta<result.devices[dev].states.length;sta++) {
                // Room:Device:Variable = {service,variable,value,id,device}
                // state
                node.items[node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable]=result.devices[dev].states[sta];
                // id
                node.items[node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable].device=result.devices[dev].id;
              }
            }
          }
        }
      });
    };

    node.fetchData=function() {
      if (node.active) {
        var url = "";
        // first run? (simplified from initLooper)
        if (node.loadtime==0) {
          // url to get all available data
          url = "http://"+node.host+":"+node.port+"/data_request?id=status2&output_format=json";
        } else {
          // url to get changed data since 
          url = "http://"+node.host+":"+node.port+"/data_request?id=status2&LoadTime="+node.loadtime+"&DataVersion="+node.dataversion+"&Timeout=40&MinimumDelay=0&output_format=json";
        }

        // callback changed to standard node convention of error first
        // see https://stackoverflow.com/a/40512067/4603891
        node.loadUrl(url,function(err, result) { // get the object
          if (err!==null) {
            node.loadtime=0;
            node.dataversion=0;
            node.error(err);
          } else {
            node.loadtime=result.LoadTime;
            node.dataversion=result.DataVersion;
            // devices present?
            if (typeof(result.devices)!="undefined" && result.devices!==null) {
              // loop through devices
              for (var dev=0;dev<result.devices.length;dev++) {
                 // state present?
                if (typeof(result.devices[dev].states)!="undefined" && result.devices[dev].states!==null) {
                  // loop through states
                  for (var sta=0;sta<result.devices[dev].states.length;sta++) {
                    // topic
                    var item=node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable;
                    // payload
                    var value=result.devices[dev].states[sta].value;
                    // if value is a number, cast value to number
                    if (!isNaN(value)) value = +value;
                    // convert 1/0 to true/false for SwitchPower1
                    if (typeof node.items[item] !== 'undefined' && node.items[item].service=="urn:upnp-org:serviceId:SwitchPower1") {
                        if (value==1) {
                            value=true;
                        } else {
                            value=false;
                        }
                    }
                    // send message                       
                    node.alertSubscriber(item,value);
                  }
                }
              }
            }
          }
          node.initLooper(); // set the timer to check again
        });
      }
    };

    node.initLooper=function() {
      // Sets timer to re-check for changes
      node.tout = setTimeout(function() {
        // this function was simplified
          node.fetchData()
      }, node.timer);
    };

    node.alertSubscriber=function(item,value) {
      // node.warn(`Items: ${JSON.stringify(node.items)}`);
      // node.warn(`Subscribers: ${JSON.stringify(node.subscribers)}`);
      // node.warn(`Devices: ${JSON.stringify(node.devices)}`);
      // node.warn(`Rooms: ${JSON.stringify(node.rooms)}`);
      // sends changes for devices specified by user
      for (var id in node.subscribers) {
        if (node.subscribers.hasOwnProperty(id)) {
          if ((node.subscribers[id].exactMatch && node.subscribers[id].src==item) || (!node.subscribers[id].exactMatch && item.length>=node.subscribers[id].src.length && item.substring(0,node.subscribers[id].src.length)==node.subscribers[id].src)) {
          //  node.debug(id+" > "+node.subscribers[id].src+" : "+item+"="+value)
              node.subscribers[id].node.sendme({topic:item,payload:value});
          }
        }
      }

    };

    node.doMessage=function(device,service,action,value) {
      node.loadUrl("http://"+node.host+":"+node.port+"/data_request?id=action&output_format=json&DeviceNum="+device+"&serviceId="+service+"&action="+action+"="+value+"&output_format=json",function(err,result) {
      });
    };

    node.sendMessage=function(item,value) {
      var i=node.items[item];
      if (i) {
        switch (i.service) {
          case "urn:upnp-org:serviceId:SwitchPower1":
            node.doMessage(i.device,i.service,"SetTarget&newTargetValue",((value=="on" || value==true)?1:((value=="off" || value==false)?0:value)));
            break;
          case "urn:upnp-org:serviceId:Dimming1":
            node.doMessage(i.device,i.service,"SetLoadLevelTarget&newLoadlevelTarget",value);
            break;
          case "urn:micasaverde-com:serviceId:DoorLock1":
            node.doMessage(i.device,i.service,"SetTarget&newTargetValue",value);
            break;
          case "urn:upnp-org:serviceId:TemperatureSetpoint1":
            node.doMessage(i.device,i.service,"SetCurrentSetpoint&NewCurrentSetpoint",value);
            break;
          case "urn:micasaverde-com:serviceId:SecuritySensor1":
            node.doMessage(i.device,i.service,"SetArmed&newArmedValue",value);
            break;
          case "urn:upnp-org:serviceId:TemperatureSensor1":
            node.doMessage(i.device,i.service,"CurrentTemperature",value);
            break;
          default:
            node.info(item+": Invalid service ("+i.service+")");
        }
      }
    };

    node.on("close",function() {
      // changed to clear all references to array
      node.subscribers.length = 0;
      if (node.tout) {
        clearInterval(node.tout); }
      node.active=false;
    });

    node.subscribe=function(miosInNode,item,exact) {
      node.subscribers[miosInNode.id]={node:miosInNode,src:item,exactMatch:exact};
    };

    node.desubscribe=function(miosInNode,done) {
      delete node.subscribers[miosInNode.id];
      done();
    };


    // Initial read
    node.initItems();
    node.initLooper();

  }
  RED.nodes.registerType("mios-server",MiosServer);

  function MiosInNode(config) {
    RED.nodes.createNode(this,config);
    var node=this;
    node.name=config.name;
    node.item=config.item;
    node.exactMatch=config.exact;
    node.server=config.server;
    node.frequency=config.frequency; // added to let user tweak update frequency
    node.serverConfig=RED.nodes.getNode(node.server);
    node.serverConfig.subscribe(this,node.item,node.exactMatch);
    node.on("connect",function() {

    });
    node.on("close",function() {

    });
    node.sendme=function(msg) {
      try { 
        node.send(msg); 
      } catch(e) {

      }
    };
    node.updateConnected=function(connected) {
      if (connected) {
        node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
      } else {
        node.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
      }
    };
  }
  RED.nodes.registerType("mios-in",MiosInNode);

  function MiosOutNode(config) {
    RED.nodes.createNode(this,config);
    var node=this;
    node.name=config.name;
    node.item=config.item;
    node.server=config.server;
    node.serverConfig=RED.nodes.getNode(node.server);
    node.on("connect",function() {

    });
    node.on("input",function(msg) {
      var target=(node.item?node.item:msg.topic);
      node.serverConfig.sendMessage(target,msg.payload);
    });
  }
  RED.nodes.registerType("mios-out",MiosOutNode);
};
