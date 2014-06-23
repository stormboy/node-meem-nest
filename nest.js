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
	this.targetTemperatureOutTopic = this.nestTopic + "/" + this.deviceName + "out/tempSetpoint"	// monitor setpoint
	this.targetTemperatureInTopic  = this.nestTopic + "/" + this.deviceName + "in/tempSetpoint"	// control setpoint
	
	this._mqttClient = null;
	this._lastUpdateTime = 0;
	this._minStatusInterval = 300000;
	
};

util.inherits(NestMeem, EventEmitter);

NestMeem.prototype.start = function() {
	var self = this;
	this._running = true;
	this._waitingForNest = false;	// waiting for subscription to nest event to return 
	this._connectNest();
	this._connectMqtt();
	this._monitor = setInterval(function() {
		var now = new Date().getTime();
		if (now - self._lastUpdateTime > self._minStatusInterval) {
			self._waitingForNest = false;
			self._fetchNestStatus();
		}
	}, 60000);
};

NestMeem.prototype.close = function() {
	clearInterval(this._monitor);
	this._running = false;
	this._mqttClient.end();
};

NestMeem.prototype.setDeviceName = function(name) {
	this.deviceName = name;
	
	// TODO unsubscribe to any previous subscriptons

	this.tempTopic = this.nestTopic + "/" + this.deviceName + "/currentTemperature";
	this.targetTemperatureOutTopic = this.nestTopic + "/" + this.deviceName + "out/tempSetpoint"	// monitor setpoint
	this.targetTemperatureInTopic  = this.nestTopic + "/" + this.deviceName + "in/tempSetpoint"	// control setpoint
	
	//this.modeTopic = this.nestTopic + "/" + name + "/mode";

	//this._mqttSubscribe();
};

NestMeem.prototype._mqttSubscribe = function() {
	if (this._connected) {
		// input topics
		this._mqttClient.subscribe(this.targetTemperatureInTopic);
		//this.mqttClient.subscribe(this.modeInTopic);

		// subscribe to content request topics
		this._mqttClient.subscribe(this.tempTopic + "?");
		this._mqttClient.subscribe(this.targetTemperatureOutTopic + "?");
	}
};

NestMeem.prototype._handleTargetTemperature = function(value) {
	// TODO send to Nest service
}

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

NestMeem.prototype._sendTargetTemperature = function(deviceId, deviceName, temp, timestamp) {
	console.log(new Date() + " : sending target temperature: " + temp + " time: " + timestamp + " on " + this.targetTemperatureOutTopic);
	timestamp = new Number(timestamp);
	this._targetTemperature = {
		value : temp,
		unit : "tempC",
		timestamp : new Date(timestamp).toISOString()
	};
	this._mqttClient.publish(this.targetTemperatureOutTopic, JSON.stringify(this._targetTemperature));
	//this._lastUpdateTime = new Date().getTime();
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

NestMeem.prototype._fetchNestStatus = function() {
	var self = this;
	nest.fetchStatus(function(data) {
		for (var deviceId in data.device) {
			if (data.device.hasOwnProperty(deviceId)) {
				var device = data.shared[deviceId];
				//console.log(util.format("%s [%s], Current temperature = %d C target=%d", device.name, deviceId, device.current_temperature, device.target_temperature));
				console.log("Device data: " + JSON.stringify(device));
				self._sendCurrentTemperature(deviceId, device.name, device.current_temperature, device.$timestamp);
				self._sendTargetTemperature(deviceId, device.name, device.target_temperature, device.$timestamp);
				//self._sendAwayStatus(device.auto_away);	// 0 = occupied, 1 = away
			}
		}
		self._subscribeNest();
	});
};

NestMeem.prototype._subscribeNest = function() {
	if (this._waitingForNest) {
		console.log("already waiting for nest. cancel subscription");
		return;
	}
	var self = this;
	//console.log("Nest: subscribing to nest");
	nest.subscribe(function(deviceId, data, type) {
		self._subscribeNestDone(deviceId, data, type);
	}, ['shared', 'user', 'device', 'structure']);
};

NestMeem.prototype._subscribeNestDone = function(deviceId, data, type) {
	var self = this;
	self._waitingForNest = false;
	// data if set, is also stored here: nest.lastStatus.shared[thermostatID]
	if (deviceId) {
		// current_schedule_mode
		console.log('Nest: Device=' + deviceId + " type=" + type);
		console.log("Nest data: " + JSON.stringify(data));

		if (type == "shared") {
			self._sendCurrentTemperature(deviceId, data.name, data.current_temperature, data.$timestamp);
			self._sendTargetTemperature(deviceId, device.name, device.target_temperature, device.$timestamp);
		}
		else if (type == "energy_latest") {
			// do something
		}
		else {
			//console.log("Nest data: " + JSON.stringify(data));
		}
		if (self._running) {
			// subscribe, but not immediatey
			self._subscribeTimeout = setTimeout(function() {
				delete self._subscribeTimeout;
				self._subscribeNest();
			}, 10000);
		}
	}
	else {
		// no data, error from  nest call
		var now = new Date().getTime();
		if (now - self._lastUpdateTime > self._minStatusInterval) {
			//console.log('Nest: no data');
			self._fetchNestStatus();
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
			if (requestTopic == self.targetTemperatureOutTopic) {
				mqttClient.publish(responseTopic, JSON.stringify(self._targetTemperature));
			}
		} else {// inbound message. handle
			// TODO handle in topics
			if (packet.topic == self.targetTemperatureInTopic) {
				var message = JSON.parse(payload);
				self._handleTargetTemperature(message.value);
			}
		}
	});

};

