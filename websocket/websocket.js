/**
 * pre-requisite of this script
 * golang installed
 * k6 installed 
 * xk6 installed : go install go.k6.io/xk6@latest
 * library installed : xk6 build v0.58.0 --with github.com/avitalique/xk6-file@latest
 * 
 * run
 * ./k6 run websocket.js
 */

import http from 'k6/http';
import encoding from 'k6/encoding';
import { WebSocket } from 'k6/experimental/websockets';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'k6/timers';
import { conf } from '../config.js';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const csvData = new SharedArray('another data name', function () {
    return papaparse.parse(open('./users.csv'), { header: true }).data;
});

const testStartedAt = Date.now();
const TOTAL_TEST_DURATION = 480 * 1000;
const WEBSOCKET_HEADER_LOBBY_SESSION_ID = 'X-Ab-LobbySessionID';

export const options = {
    scenarios: {
        contacts: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '120s', target: 30 },
                { duration: '120s', target: 30 },
                { duration: '120s', target: 20 },
                { duration: '120s', target: 10 },
            ],
            gracefulRampDown: '30s',
            gracefulStop: '10s'
        },
    },
};

export default function () {
    const user = csvData[__VU];
    const url = `${conf.base_url}/oauth/token`;
    const params = {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${encoding.b64encode(`${conf.gameClientId}:`)}`,
        },
    };

    const formData = {
        grant_type: 'password',
        username: `${user.email}`,
        password: `${conf.userLoginPassword}`,
    };

    const res = http.post(url, formData, params);
    let token = '';

    if (res.status === 200) {
        token = JSON.parse(res.body).access_token;
    } else {
        console.log(`login fail`);
        return;
    }

    let headers = {
        Authorization: `Bearer ${token}`,
    }
    let paramsws = {
        headers: headers
    }

    let lobbySessionID = '';

    // let isClosing = false;
    const now = Date.now();
    const remainingTimeMs = Math.max(0, TOTAL_TEST_DURATION - (now - testStartedAt));
    const remainingTimeSec = remainingTimeMs / 1000;

    console.log(`VU ${__VU} will live for ~${remainingTimeSec.toFixed(1)}s`);

    const ws = new WebSocket(`${conf.ws_url}`, null, paramsws);

    ws.addEventListener('open', () => {
        console.log(`WS opened by VU ${__VU}`);

        const intervalId = setInterval(() => {
            try {
                ws.ping();
                console.log(`VU ${__VU} ping sent`);
            } catch (err) {
                console.log(`ping failed: VU ${__VU}`, err.message);
            }
        }, 10000);

        ws.addEventListener('message', (message) => {
            const msg = message.data;
            console.log(`VU ${__VU} received: ${msg}`);

            const extracted = extractLobbySessionID(msg);
            if (extracted) {
                lobbySessionID = extracted;
                console.log(`VU ${__VU} got lobbySessionID: ${lobbySessionID}`);
                paramsws = {
                    ...headers,
                    [WEBSOCKET_HEADER_LOBBY_SESSION_ID]: lobbySessionID
                }
            }
        });

        ws.addEventListener('pong', () => {
            console.log(`VU ${__VU} got pong`);
        });

        const shutdownBufferSec = 3;
        const targetDurationSec = remainingTimeSec - shutdownBufferSec;
        console.log(`VU ${__VU} target duration is ~${targetDurationSec.toFixed(1)}s`);

        const timeOutID = setTimeout(() => {
            console.log(`VU ${__VU} shutting down gracefully`);
            clearInterval(intervalId);
            clearTimeout(timeOutID)
            ws.close();
        }, (targetDurationSec * 1000));
    });

    ws.addEventListener('close', () => {
        console.log(`WS closed by VU ${__VU}`);
    });

    ws.addEventListener('error', (e) => {
        console.log(`VU ${__VU} error: ${e.error || e.message}`);
        ws = new WebSocket(`${conf.ws_url}`, null, paramsws);
    });
}

function extractLobbySessionID(message) {
    const lines = message.trim().split('\n');
    let type = null;
    let lobbySessionID = null;

    for (const line of lines) {
        const [key, ...rest] = line.split(':');
        if (!key || rest.length === 0) continue;

        const value = rest.join(':').trim();

        if (key.trim() === 'type') {
            type = value;
        }

        if (key.trim() === 'lobbySessionID') {
            lobbySessionID = value;
        }
    }

    return type === 'connectNotif' ? lobbySessionID : null;
}