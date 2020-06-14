module.exports = function(RED) {
  function MiosServer(config) {
    RED.nodes.createNode(this,config);
    var node=this;
    node.name=config.name;
    node.host=config.host;
    node.port=(config.port?config.port:3480);
    node.timer=100;
    node.getjson = "&output_format=json";
    node.loadtime=0;
    node.dataversion=0;
    node.items=[];
    node.subscribers=[];
    node.devices=[];
    node.rooms=[];
    node.active=true;

    this.updateConnected=function(connected) {
      node.timer=(connected?100:10000);
      for (var id in node.subscribers) {
        if (node.subscribers.hasOwnProperty(id)) {
          node.subscribers[id].node.updateConnected(connected);
        }
      }
    };

    this.loadUrl=function(url,callback) {
      var result;
      if (url) {
        var http=require("http");
        http.get(url,function(res) {
          var data="";

          res.on("data",function(d) {
            data+=d;
          });

          res.on("end",function() {
            try {
              result=JSON.parse(data);
            } catch (e) {
              callback(null,RED._("mios.error.invalid-json"));
              return;
            }

            node.updateConnected(true);
            callback(result,null);
            return;
          });

        }).on("error",function(e) {
          node.updateConnected(false);
          callback(null,e);
          return;
        });
      } else {
        callback(null,RED._("mios.error.invalid-url"));
      }
    };

    this.updateItems=function() {
      this.loadUrl("http://"+this.host+":"+this.port+"/data_request?id=user_data"+node.getjson,function(result,err) {
        if (err!==null) {
          node.error(err);
        } else {
          node.items=[];
          node.rooms=[];
          node.devices=[];
          node.loadtime=result.LoadTime;
          node.dataversion=result.DataVersion;
          node.rooms[0]={name:"Unknown",id:0};
          for (var room=0;room<result.rooms.length;room++) {
            node.rooms[result.rooms[room].id]={name:result.rooms[room].name,id:result.rooms[room].id};
          }
          for (var dev=0;dev<result.devices.length;dev++) {
            if (typeof(result.devices[dev].room)!="undefined") {
              node.devices[result.devices[dev].id]=node.rooms[result.devices[dev].room].name+":"+result.devices[dev].name;
              for (var sta=0;sta<result.devices[dev].states.length;sta++) {
                // Room:Device:Variable = {service,variable,value,id,device}
                node.items[node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable]=result.devices[dev].states[sta];
                node.items[node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable].device=result.devices[dev].id;
              }
            }
          }
        }
      });
    };
    this.initLooper=function() {
      node.tout = setTimeout(function() {
        if (node.loadtime==0) {
          node.fetchData(true);
        } else {
          node.fetchData(false);
        }
      }, node.timer);
    };

    this.fetchData=function(full) {
      if (!this.active) return;

      if (full) {
        this.loadUrl("http://"+this.host+":"+this.port+"/data_request?id=status2"+node.getjson,function(result,err) {
          if (err!==null) {
            node.error(err);
          } else {
            node.loadtime=result.LoadTime;
            node.dataversion=result.DataVersion;
          }
          // node.initLooper(); // don't need to call this function recursively
        });
      } else {
        this.loadUrl("http://"+this.host+":"+this.port+"/data_request?id=status2&LoadTime="+this.loadtime+"&DataVersion="+this.dataversion+"&Timeout=40&MinimumDelay=0"+node.getjson,function(result,err) {
          if (err!==null) {
            node.loadtime=0;
            node.dataversion=0;
            node.error(err);
          } else {
            node.loadtime=result.LoadTime;
            node.dataversion=result.DataVersion;

            if (typeof(result.devices)!="undefined" && result.devices!==null) {
              for (var dev=0;dev<result.devices.length;dev++) {
                if (typeof(result.devices[dev].states)!="undefined" && result.devices[dev].states!==null) {
                  for (var sta=0;sta<result.devices[dev].states.length;sta++) {
                    var item=node.devices[result.devices[dev].id]+":"+result.devices[dev].states[sta].variable;
                    var value=result.devices[dev].states[sta].value;
                    if (!isNaN(value)) value=+value;
                        if (typeof node.items[item] !== 'undefined' && node.items[item].service=="urn:upnp-org:serviceId:SwitchPower1") {
                            if (value==1) {
                                value=true;
                            } else {
                                value=false;
                            }
                        }
                    node.alertSubscriber(item,value);
                  }
                }
              }
            }
          }
        
        // node.initLooper(); // don't need to call this function recursively

        });
      }
    };

    this.alertSubscriber=function(item,value) {
      for (var id in node.subscribers) {
        if (node.subscribers.hasOwnProperty(id)) {
          if ((node.subscribers[id].exactMatch && node.subscribers[id].src==item) || (!node.subscribers[id].exactMatch && item.length>=node.subscribers[id].src.length && item.substring(0,node.subscribers[id].src.length)==node.subscribers[id].src)) {
          //  node.debug(id+" > "+node.subscribers[id].src+" : "+item+"="+value)
              node.subscribers[id].node.sendme({topic:item,payload:value});
          }
        }
      }

    };

    this.doMessage=function(device,service,action,value) {
      node.loadUrl("http://"+node.host+":"+node.port+"/data_request?id=action&output_format=json&DeviceNum="+device+"&serviceId="+service+"&action="+action+"="+value+node.getjson,function(result,error) {
      });
    };

    this.sendMessage=function(item,value) {
      var i=node.items[item];
      if (i) {
        switch (i.service) {
          case "urn:upnp-org:serviceId:SwitchPower1":
            this.doMessage(i.device,i.service,"SetTarget&newTargetValue",((value=="on" || value==true)?1:((value=="off" || value==false)?0:value)));
            break;
          case "urn:upnp-org:serviceId:Dimming1":
            this.doMessage(i.device,i.service,"SetLoadLevelTarget&newLoadlevelTarget",value);
            break;
          case "urn:micasaverde-com:serviceId:DoorLock1":
            this.doMessage(i.device,i.service,"SetTarget&newTargetValue",value);
            break;
          case "urn:upnp-org:serviceId:TemperatureSetpoint1":
            this.doMessage(i.device,i.service,"SetCurrentSetpoint&NewCurrentSetpoint",value);
            break;
          case "urn:micasaverde-com:serviceId:SecuritySensor1":
            this.doMessage(i.device,i.service,"SetArmed&newArmedValue",value);
            break;
          case "urn:upnp-org:serviceId:TemperatureSensor1":
            this.doMessage(i.device,i.service,"CurrentTemperature",value);
            break;
          default:
            node.info(item+": Invalid service ("+i.service+")");
        }
      }
    };

    node.on("close",function() {
      this.subscribers=[];
      if (this.tout) {
        clearInterval(this.tout); }
      this.active=false;
    });

    this.subscribe=function(miosInNode,item,exact) {
      this.subscribers[miosInNode.id]={node:miosInNode,src:item,exactMatch:exact};
    };

    this.desubscribe=function(miosInNode,done) {
      delete this.subscribers[miosInNode.id];
      done();
    };


    // Initial read
    this.updateItems();
    this.initLooper();

  }
  RED.nodes.registerType("mios-server",MiosServer);

  function MiosInNode(config) {
    RED.nodes.createNode(this,config);
    var node=this;
    node.name=config.name;
    node.item=config.item;
    node.exactMatch=config.exact;
    node.server=config.server;
    node.serverConfig=RED.nodes.getNode(this.server);
    node.serverConfig.subscribe(this,node.item,node.exactMatch);
    node.on("connect",function() {

    });
    node.on("close",function() {

    });
    this.sendme=function(msg) {
      try { 
        node.send(msg); 
      } catch(e) {

      }
    };
    this.updateConnected=function(connected) {
      if (connected) {
        node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
      } else {
        this.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
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
    node.serverConfig=RED.nodes.getNode(this.server);
    node.on("connect",function() {

    });
    node.on("input",function(msg) {
      var target=(node.item?node.item:msg.topic);
      node.serverConfig.sendMessage(target,msg.payload);
    });
  }
  RED.nodes.registerType("mios-out",MiosOutNode);
};
