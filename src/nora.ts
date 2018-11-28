import { Observable, Subject } from 'rxjs';
import { delay, finalize, retryWhen, shareReplay, takeUntil } from 'rxjs/operators';
import * as io from 'socket.io-client';
import { NoraConnection } from './nora-connection';

export class NoraService {

    private socketByToken: {
        [token: string]: {
            stop: Subject<any>;
            socket: Observable<NoraConnection>;
            uses: number;
            stopTimer?: NodeJS.Timeout;
        };
    } = {};

    constructor(red) {
    }

    getSocket(token: string) {
        let existing = this.socketByToken[token];
        if (!existing) {
            const stop = new Subject();
            this.socketByToken[token] = existing = {
                socket: this.createSocketObservable(token, stop),
                uses: 0,
                stop,
            };
        }

        return new Observable<NoraConnection>(observer => {
            existing.uses++;
            if (existing.stopTimer) {
                clearTimeout(existing.stopTimer);
            }
            return existing.socket.pipe(finalize(() => {
                existing.uses--;
                if (existing.uses === 0) {
                    clearTimeout(existing.stopTimer);
                    existing.stopTimer = setTimeout(() => {
                        if (existing.uses === 0) {
                            existing.stop.next();
                            existing.stop.complete();
                            delete this.socketByToken[token];
                        }
                    }, 10000);
                }
            })).subscribe(observer);
        });
    }

    private createSocketObservable(token: string, stop: Observable<any>) {
        return new Observable<NoraConnection>(observer => {
            console.log('nora: connecting');
            const socket = io(`https://node-red-google-home.herokuapp.com/?token=${token}`);
            socket.on('error', err => {
                console.log(`nora: socket connection error: ${err}`);
                observer.error(new Error(`nora: socket connection error: ${err}`));
            });
            observer.next(new NoraConnection(socket));
            socket.on('connect', () => console.log('nora: connected'));
            socket.on('disconnect', reason => console.log(`nora: disconnected (${reason})`));
            return () => {
                console.log('nora: close connection');
                socket.close();
            };
        }).pipe(
            retryWhen(err => err.pipe(delay(10000))),
            takeUntil(stop),
            shareReplay(1),
        );
    }
}

