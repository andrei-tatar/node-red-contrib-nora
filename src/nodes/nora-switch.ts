import { getService } from '..';
import { SwitchNode } from '../switch-node';

module.exports = function (RED) {
    RED.nodes.registerType('nora-switch', function (config) {
        SwitchNode.call(this, getService(RED), RED, config);
    });
};

