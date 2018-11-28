import * as io from 'socket.io-client';
import { Observable } from 'rxjs';
import { retryWhen, delay } from 'rxjs/operators';

const token = `secret`;

const socket$ = new Observable<SocketIOClient.Socket>(observer => {
    console.log('connecting to NORA');
    var socket = io(`https://node-red-google-home.herokuapp.com/?token=${token}`);
    socket.on('error', err => {
        observer.error(new Error(`socket connection error: ${err}`))
    });
    observer.next(socket);
    socket.on('connect', function () {
        console.log('connected');
        socket.emit('sync', {
            'light1': {
                type: 'light',
                name: 'light',
                brightnessControl: true,
                state: {
                    online: true,
                    brightness: 67,
                    on: true,
                },
            },
        });
    });
    socket.on('disconnect', function (reason) {
        console.log('disconnected');
    });
}).pipe(
    retryWhen(err => err.pipe(delay(10000))),
);

socket$.subscribe(s => {

});

