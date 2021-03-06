// Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

//import(import.meta.url).then(v=>window.mod=v);

//import "https://rawgit.com/bellbind/web-streams-polyfill/master/dist/polyfill.min.js";
//import "https://rawgit.com/creatorrr/web-streams-polyfill/master/dist/polyfill.min.js";
import TransformStream from "./lib/transform-stream.js";

import picotcp from "./picotcp.js/picotcp.js";

export {picotcp};
export let globalStack;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const cidrToSubnet = (string) => {
    const [ip, prefixString] = string.split("/", 2);
    const prefixLength = parseInt(prefixString);
    const subnet = prefixLength && (-1 << (32 - prefixLength) >>> 0);
    return [ip, `${subnet >>> 24 & 0xff}.${subnet >>> 16 & 0xff}.${subnet >>> 8 & 0xff}.${subnet >>> 0 & 0xff}`];
};

export const parseMAC = (string) =>
    string.split(/:|-/).map(v => parseInt(v, 16));

export class Stream2 {
    constructor() {
        return new WritableStream(this);
    }
    write(controller, chunk) {
        console.log(chunk);
        return new Promise(() => {});
    }
}

export const pcapHeader = new Blob([new Uint32Array([
    0xa1b2c3d4,
    0x00040002,
    0x00000000,
    0x00000000,
    0x0000ffff,
    0x00000001,
])]);

class StreamRecorder {
    constructor(data = [pcapHeader]) {
        this.data = data;
    }
    transform(chunk, controller) {
        const buffer = chunk; // .buffer || chunk;
        const length = buffer.byteLength;
        const now = Date.now();
        const header = new Uint32Array([
            now / 1000,
            (now % 1000) * 1000,
            length,
            length,
        ]);
        this.data.push(new Blob([header, buffer]));
        controller.enqueue(chunk);
    }
}

export class RecordStream extends TransformStream {
    constructor(data) {
        const recorder = new StreamRecorder(data);
        super(recorder);
        this.recorder = recorder;
    }
    getDump() {
        return new Blob(this.recorder.data);
    }
}

export function saveAs(blob, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    // Firefox needs `a` to be connected to document.
    document.head.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

export function randomMac() {
    const mac = self.crypto.getRandomValues(new Uint8Array(6));
    // Unicast, locally administered.
    mac[0] = mac[0] & ~0b00000001 | 0b00000010;
    return mac;
}

export class NetworkStack {
    constructor({mac, ipv4} = {}) {
        return (async () => {
            this._picotcp = await picotcp();
            this.start();
            return this;
        })();
    }

    start() {
        this._interval = setInterval(this.tick.bind(this), 10/*500*/);
    }
    stop() {
        clearInterval(this._interval);
        this._interval = null;
    }
    tick() {
        this._picotcp._pico_stack_tick();
    }
    async addInterface({mac = randomMac(), ip}) {
        const dev = await new NIC(this, mac);
        if (ip) dev.addIPv4(ip);
        return dev;
    }
}

let defaultNetwork;

export class NIC {
    constructor(stack, mac = randomMac()) {
        return (async () => {
            if (!stack) {
                if (!defaultNetwork) defaultNetwork = new NetworkStack();
                stack = await defaultNetwork;
            }
            this.stack = stack;
            this.dev = this.stack._picotcp.ccall("pico_js_create", "number", ["string", "array"], ["", mac]);
            return this;
        })();
    }
    addIPv4(ip = "", netmask = "255.255.255.0") {
        this.stack._picotcp.ccall("js_add_ipv4", "number", ["number", "string", "string"], [this.dev, ip, netmask]);
    }
    async ping(dst, timeout = 1000) {
        let resolve;
        const promise = new Promise(_resolve => resolve = _resolve);
        const ptr = this.stack._picotcp.addFunction(resolve);
        this.stack._picotcp.ccall("pico_icmp4_ping", "number", ["string", "number", "number", "number", "number", "number"], [dst, 1, 1, timeout, 64, ptr]);
        await promise;
        this.stack._picotcp.removeFunction(resolve);
        return promise;
    }
    get readable() {
        return this.stack._picotcp.pointers[this.dev].readable;
    }
    get writable() {
        return this.stack._picotcp.pointers[this.dev].writable;
    }
    get TCPSocket() {
        const self = this;
        return class extends TCPSocket {
            get NIC() {return self;}
        }
    }
    get TCPServerSocket() {
        const self = this;
        return class extends TCPServerSocket {
            get NIC() {return self;}
        }
    }
}

/**
 * @see https://www.w3.org/TR/tcp-udp-sockets/#interface-tcpsocket
 */
class TCPSocket {
    constructor(remoteAddress, remotePort, options = {}) {
        const PICO_PROTO_IPV4 = 0, PICO_PROTO_IPV6 = 41;
        this._ptr = this.NIC.stack._picotcp.ccall("js_socket_open", "number", ["number", "number"], [PICO_PROTO_IPV4, new.target._proto]);
        ({readable: this.readable, writable: this.writable} = this.NIC.stack._picotcp.pointers[this._ptr]);
        console.log(this.NIC.stack._picotcp.ccall("js_socket_connect", "number", ["number", "string", "number"], [this._ptr, remoteAddress, remotePort]));
        console.log(this.NIC.stack._picotcp._js_pico_err());
    }

    static get _proto() {
        const PICO_PROTO_TCP = 6, PICO_PROTO_UDP = 17;
        return PICO_PROTO_TCP;
    }
}

/**
 * @see https://www.w3.org/TR/tcp-udp-sockets/#interface-tcpserversocket
 */
class TCPServerSocket {
    constructor({localAddress, localPort} = {}) {
        const PICO_PROTO_IPV4 = 0, PICO_PROTO_IPV6 = 41;
        this._ptr = this.NIC.stack._picotcp.ccall("js_socket_open", "number", ["number", "number"], [PICO_PROTO_IPV4, new.target._proto]);
        ({readable: this.readable, writable: this.writable} = this.NIC.stack._picotcp.pointers[this._ptr]);
        console.log(this.NIC.stack._picotcp.ccall("js_socket_bind", "number", ["number", "string", "number"], [this._ptr, localAddress, localPort]));
        console.log(this.NIC.stack._picotcp._js_pico_err());
    }

    static get _proto() {
        const PICO_PROTO_TCP = 6, PICO_PROTO_UDP = 17;
        return PICO_PROTO_TCP;
    }
}



/*
wait = ms=>{for(const end = performance.now() + ms; performance.now() < end;);}
setInterval(()=>{console.log(++x);wait(1100*a);console.log("done",x);}, 1000);x=0;a=1
*/

/** @param {Uint8Array} buffer */
self.SEND = buffer => {
    /** @type {WebSocket} */ const ws = window.ws;
    const length = buffer.length;
    // console.log("SENDING into VM -->", buffer, length);
    const blob = new Blob([new Uint8Array([length >> 8, length & 0xff]), buffer]);
    ws.send(blob);
    return length;
};

self.POLL = (n, dev, module) => {
    while (n--) {
        if (!window.Q.length) break;
        const buf = window.Q.shift();
        // TODO: When do we need to free this?
        const pointer = module._malloc(buf.length);
        module.writeArrayToMemory(buf, pointer);
        // console.log("<-- GETTING from VM", new Uint8Array(buf), buf.length, pointer);
        module.ccall("pico_stack_recv", "number", ["number", "number", "number"],
            [dev, pointer, buf.length]);
    }
    return n;
};
self.Q = [];

export const messages = [];
export async function start(data) {
    // if (typeof TransformStream === "undefined") await import("https://rawgit.com/creatorrr/web-streams-polyfill/master/dist/polyfill.min.js");

    const urls = Object.entries(data).filter(([k]) => k.startsWith("ws+ethernet+"));
    const url = new URL(urls[0][1]);
    const ws = new WebSocket(url);

    let stack;
    ws.onopen = async () => {
        await sleep(7000);
        console.log("open ws");
        stack = picotcp();
        globalStack = stack;
        console.log("opoen,", stack);
        setInterval(() => stack._pico_stack_tick(), 500);
    };
    ws.binaryType = "arraybuffer";
    /*ws.onmessage = ev => {
        const buf = new Uint8Array(ev.data);
        messages.push(Array.from(buf));
        console.log(buf);
    };*/

    window.ws = ws;
    const stream = wrapWebSocket(ws)
        .pipeThrough(new Uint8ArrayStream())
        .pipeThrough(new VDEParser())
/*        // VDE does not send a CRC.
        .pipeThrough(new EthernetParser({crcLength: 0}))
        // .pipeThrough(new EthernetPrinter())
        .pipeThrough(new IPv4Parser())
        .pipeThrough(new UDPParser())
*/        ;
    const read = stream.getReader();

    for await (const chunk of read) {
        window.Q.push(chunk);
        try {stack._pico_stack_tick();} catch (e) {}
        // console.log(chunk);
    }

}

new ReadableStream().getReader().__proto__[Symbol.asyncIterator] = function () {
    return {
        next: () => this.read(),
    };
}

export class StreamPrinter extends TransformStream {
    constructor(tag = "StreamPrinter") {
        super({
            transform(chunk, controller) {
                console.log(tag, chunk);
                controller.enqueue(chunk);
            }
        });
    }
}

export class EthernetPrinter extends TransformStream {
    constructor() {
        /**
         * @param {Uint8Array} frame
         * @param {*} controller
         */
        const transform = (frame, controller) => {
            controller.enqueue({
                ...frame,
                source: Array.from(frame.source).map(v => v.toString(16)),
                dest: Array.from(frame.dest).map(v => v.toString(16)),
                type: frame.type.toString(16),
                frame,
            });
        };
        super({transform});
    }
}

export function wrapWebSocket(ws) {
    return new ReadableStream({
        start(controller) {
            ws.addEventListener("message", ({data}) => controller.enqueue(data));
        }
    });
}

function getPromise() {
    let resolve, reject;
    const promise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    return {promise, resolve, reject};
};

export class Uint8ArrayStream extends TransformStream {
    constructor(websocketStream) {
        const reader = new FileReader();
        super({
            async transform(chunk, controller) {
                let ret;
                if (chunk instanceof Blob) {
                    reader.readAsArrayBuffer(chunk);
                    await ({resolve: reader.onload, reject: reader.onerror} = getPromise()).promise;
                    chunk = reader.result;
                }
                if (chunk.buffer) chunk = chunk.buffer;
                if (chunk instanceof ArrayBuffer) ret = new Uint8Array(chunk);
                else return;
                controller.enqueue(ret);
            }
        });
    }
}

