"use strict";

var util = require('util')
  , nest = require('unofficial-nest-api')
  , mqtt = require('mqtt')
  , EventEmitter = require('events').EventEmitter
  , crypto = require('crypto');

/**
 * TODO allow control: set-point, away mode
 */
var NestMeem = module.exports = function(options) {
	EventEmitter.call(this);

	this._options = options;
	this._currentTemperature = {};
	this.deviceName = "Home";

	this.nestTopic = "/house/thermostat";
	this.tempTopic = this.nestTopic + "/" + this.deviceName + "/currentTemperature";
	
	this._mqttClient = null;
	this._lastUpdateTime = 0;
	this._minStatusInterval = 300000;
	
};

util.inherits(NestMeem, EventEmitter);

NestMeem.prototype.start = function() {
	this._running = true;
	this._connectNest();
	this._connectMqtt();
};

NestMeem.prototype.close = function() {
	this._running = false;
	this._mqttClient.end();
};

NestMeem.prototype.setDeviceName = function(name) {
	// TODO unsubscribe to any previous subscriptons

	this.tempTopic = this.nestTopic + "/" + name + "/currentTemperature";

	//this.tempSetpointTopic = this.nestTopic + "/" + name + "/temperatureSetpoint";
	//this.modeTopic = this.nestTopic + "/" + name + "/mode";

	this._mqttSubscribe();
};

NestMeem.prototype._mqttSubscribe = function() {
	if (this._connected) {
		//this.mqttClient.subscribe({topic: self.topicTemperatureSetpoint});

		// subscribe to content request topics
		this._mqttClient.subscribe(this.tempTopic + "?");
		// subscribe to requests for state
	}
};

NestMeem.prototype._sendCurrentTemperature = function(deviceId, deviceName, temp, timestamp) {
	console.log(new Date() + " : sending currentTemp: " + temp + " time: " + timestamp + " on " + this.tempTopic);
	timestamp = new Number(timestamp);
	this._currentTemperature = {
		value : temp,
		unit : "tempC",
		timestamp : new Date(timestamp).toISOString()
	};
	this._mqttClient.publish(this.tempTopic, JSON.stringify(this._currentTemperature));
	this._lastUpdateTime = new Date().getTime();
};

NestMeem.prototype._connectNest = function() {
	var self = this;
	//nest.init(settings.username, settings.password);
	nest.login(this._options.username, this._options.password, function(err, data) {
		if (err) {
			console.log('Nest: Login failed: ' + err);
			process.exit(1);
			return;
		}
		console.log('Nest: Logged in.');
		self._fetchNestStatus();
	});
};

NestMeem.prototype._fetchNestStatus = function(doSubscribe) {
	if (doSubscribe === undefined) {
		doSubscribe = true;
	}
	var self = this;
	nest.fetchStatus(function(data) {
		for (var deviceId in data.device) {
			if (data.device.hasOwnProperty(deviceId)) {
				var device = data.shared[deviceId];
				//console.log(util.format("%s [%s], Current temperature = %d C target=%d", device.name, deviceId, device.current_temperature, device.target_temperature));
				console.log("Device data: " + JSON.stringify(device));
				self._sendCurrentTemperature(deviceId, device.name, device.current_temperature, device.$timestamp);
				
				//self._sendAwayStatus(device.auto_away);	// 0 = occupied, 1 = away
			}
		}
		if (doSubscribe) {
			self._subscribeNest();
		}
	});
};

NestMeem.prototype._subscribeNest = function() {
	var self = this;
	//console.log("Nest: subscribing to nest");
	nest.subscribe(function(deviceId, data, type) {
		self._subscribeNestDone(deviceId, data, type);
	}, ['shared', 'user', 'device', 'structure']);
};

NestMeem.prototype._subscribeNestDone = function(deviceId, data, type) {
	var self = this;
	// data if set, is also stored here: nest.lastStatus.shared[thermostatID]
	if (deviceId) {
		console.log('Nest: Device=' + deviceId + " type=" + type);
		console.log("Nest data: " + JSON.stringify(data));
		if (type == "shared") {
			self._sendCurrentTemperature(deviceId, data.name, data.current_temperature, data.$timestamp);
		}
		else if (type == "energy_latest") {
			// do something
		}
		else {
			//console.log("Nest data: " + JSON.stringify(data));
		}
	} else {
		var now = new Date().getTime();
		if (now - self._lastUpdateTime > self._minStatusInterval) {
			//console.log('Nest: no data');
			self._fetchNestStatus(false);
			//return;
		}
	}
	if (self._running) {
		if (!self._subscribeTimeout) {
			self._subscribeTimeout = setTimeout(function() {
				delete self._subscribeTimeout;
				self._subscribeNest();
			}, 10000);
		}
	}
};

NestMeem.prototype._connectMqtt = function() {
	var self = this;
	var clientId = crypto.randomBytes(24).toString('hex');
	var options = {
		keepalive : 60,
		clientId : clientId
	};
	var mqttClient = self._mqttClient = mqtt.createClient(this._options.mqttPort, this._options.mqttHost, options);
	
	// add handlers to MQTT client
	mqttClient.on('connect', function() {
		console.log('MQTT: connect');
		self._connected = true;
		self._mqttSubscribe();
		self.emit("lifecycle", "ready");
	});
	
	mqttClient.on('close', function() {
		console.log('MQTT: close');
		self._connected = false;
	});
	
	mqttClient.on('error', function(e) {
		// ??? seems to timeout a lot
		console.log('MQTT: error: ' + e);
	});

	mqttClient.on('message', function(topic, payload) {
		// got data from subscribed topic
		//console.log('MQTT: message: ' + topic + ' : ' + payload);

		// check if message is a request for current value, send response
		var i = topic.indexOf("?");
		if (i > 0) {// request for content
			var requestTopic = topic.slice(0, i);
			var responseTopic = payload;
			//console.log("MQTT: requestTopic: " + requestTopic + "  responseTopic: " + responseTopic);

			if (requestTopic == self.tempTopic) {
				//console.log("MQTT: sending content: " + self._currentTemperature + " on " + responseTopic);
				mqttClient.publish(responseTopic, JSON.stringify(self._currentTemperature));
			}
		} else {// inbound message. handle
			if (packet.topic == self.topicIn) {// TODO handle in topics
				var message = JSON.parse(payload);
				self.value(message.value);
			}
		}
	});

};

