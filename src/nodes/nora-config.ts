import { ConfigNode } from '../config-node';

module.exports = function (RED) {
    RED.nodes.registerType('nora-config', function (config) {
        ConfigNode.call(this, RED, config);
    });
};

