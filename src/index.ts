import { NoraService } from './nora';

let inited = false;
let service: NoraService;

export function getService(RED) {
    if (!inited) {
        service = new NoraService(RED);
    }
    return service;
}
