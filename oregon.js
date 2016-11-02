module.exports = function(RED) {
    function OregonPiNode(config) {
        var wpi = require('wiring-pi');
        var ook = require('./ook');
        RED.nodes.createNode(this, config);
        var node = this;
        node.pin = parseInt(config.pin, 10);
        // Can't use other modes without root privileges. Hardcode to 'sys' for now.
        node.mode = 'sys';
        // if version is not set for some reason then use version 2 by default
        node.version = parseInt(config.version || 2, 10);
        if (typeof node.pin !== 'undefined') {
            wpi.setup(node.mode);
            wpi.pinMode(node.pin, wpi.INPUT);
            var ookDecoder = new ook(node.version);
            wpi.wiringPiISR(node.pin, wpi.INT_EDGE_BOTH, function(delta) {
                if (ookDecoder.nextPulse(delta)) {
                    var msg = {topic: 'oregonPi/' + node.pin, version: node.version, payload: ookDecoder.sprint(true)};
                    node.status({fill: "green", shape: "dot", text: msg.payload});
                    node.send(msg);
                    ookDecoder.reset();
                }
            });
            node.status({fill: "blue", shape: "dot", text: "oregonPi.status.connected"});
        }
        node.on('close', function(done) {
            wiringPiISRCancel(node.pin);
            node.status({fill: "grey", shape: "ring", text: "oregonPi.status.closed"});
            done();
        });
    }

    function OregonSensorNode(config) {
        var Sensor = require('./sensor');
        RED.nodes.createNode(this, config);
        var node = this;
        var sensor = new Sensor();
        node.on('input', function(msg) {
            try {
                var data = sensor.decode(msg.payload);
                node.send({payload: data});
            } catch (error) {
                node.error(error);
            }
        });
    }

    RED.nodes.registerType("oregonPi", OregonPiNode);
    RED.nodes.registerType("oregon-decoder", OregonSensorNode);
};