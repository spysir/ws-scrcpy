import {StreamInfo} from "./StreamInfo";
import VideoConverter from "h264-converter";
import {ControlEvent, MotionControlEvent} from "./ControlEvent";
import MotionEvent from "./MotionEvent";
import Position from "./Position";
import Size from "./Size";
import Point from "./Point";

const MESSAGE_TYPE_TEXT = "text";
const MESSAGE_TYPE_STREAM_INFO = "stream_info";
const DEFAULT_FPF = 1;

export interface DeviceScreenErrorListener {
    OnError: (this: DeviceScreenErrorListener, ev: Event | string) => any;
}

export class DeviceScreen {
    private errorListener?: DeviceScreenErrorListener;
    private streamInfo?: StreamInfo;
    readonly ws: WebSocket;
    private converter?: VideoConverter;
    private static BUTTONS_MAP: Record<number, number> = {
        0: 17, // ?? BUTTON_PRIMARY
        1: MotionEvent.BUTTON_TERTIARY,
        2: 26  // ?? BUTTON_SECONDARY
    };

    private static EVENT_ACTION_MAP: Record<string, number> = {
        'mousedown': MotionEvent.ACTION_DOWN,
        'mousemove': MotionEvent.ACTION_MOVE,
        'mouseup': MotionEvent.ACTION_UP,
    };

    constructor(readonly tag:HTMLVideoElement, readonly url:string) {
        this.tag = tag;
        this.url = url;
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.init();
    }

    private haveConnection(): boolean {
        return this.ws && this.ws.readyState === this.ws.OPEN;
    }

    private static buildMotionEvent(e: MouseEvent, streamInfo: StreamInfo): MotionControlEvent | null {
        const action = this.EVENT_ACTION_MAP[e.type];
        if (typeof action === 'undefined' || !streamInfo) {
            return null;
        }
        const width = streamInfo.width;
        const height = streamInfo.height;
        const target: HTMLElement = <HTMLElement> e.target;
        let {clientWidth, clientHeight} = target;
        let touchX = (e.clientX - target.offsetLeft);
        let touchY = (e.clientY - target.offsetTop);
        const eps = 1e5;
        const ratio = width / height;
        const shouldBe = Math.round(eps * ratio);
        const haveNow = Math.round(eps * clientWidth / clientHeight);
        if (shouldBe > haveNow) {
            const realHeight = Math.ceil(clientWidth / ratio);
            const top = (clientHeight - realHeight) / 2;
            if (touchY < top || touchY > top + realHeight) {
                return null;
            }
            touchY -= top;
            clientHeight = realHeight;
        } else if (shouldBe < haveNow) {
            const realWidth = Math.ceil(clientHeight * ratio);
            const left = (clientWidth - realWidth) / 2;
            if (touchX < left || touchX > left + realWidth) {
                return null;
            }
            touchX -= left;
            clientWidth = realWidth;
        }
        const x = touchX * width / clientWidth;
        const y = touchY * height / clientHeight;
        const position = new Position(new Point(x, y), new Size(width, height));
        return new MotionControlEvent(action, this.BUTTONS_MAP[e.button], position);
    }

    private init() {
        const ws = this.ws;

        const onError = (e: Event | string) => {
            if (this.errorListener) {
                this.errorListener.OnError.call(this.errorListener, e);
            }
            if (ws.readyState === ws.CLOSED) {
                console.error("WS closed");
            }
        };

        ws.onerror = onError;

        ws.onmessage = (e: MessageEvent) => {
            const converter = this.converter;
            const streamInfo = this.streamInfo;
            if (e.data instanceof ArrayBuffer && converter) {
                converter.appendRawData(new Uint8Array(e.data));
            } else {
                let data;
                try {
                    data = JSON.parse(e.data);
                } catch (e) {
                    console.log(e.data);
                    return;
                }
                switch (data.type) {
                    case MESSAGE_TYPE_STREAM_INFO:
                        const newInfo = new StreamInfo(data);
                        if (converter && streamInfo && !streamInfo.equals(newInfo)) {
                            converter.appendRawData(new Uint8Array([]));
                            converter.pause();
                        }
                        this.streamInfo = newInfo;
                        this.converter = new VideoConverter(this.tag, newInfo.frameRate, DEFAULT_FPF);
                        this.converter.play();
                        break;
                    case MESSAGE_TYPE_TEXT:
                        console.log(data.message);
                        break;
                    default:
                        console.log(e.data);
                }
            }
        };

        this.tag.onerror = onError;
        this.tag.oncontextmenu = function(e) {
            e.preventDefault();
            return false;
        };

        let down = 0;

        const onMouseEvent = (e: MouseEvent) => {
            if (e.target === this.tag && this.haveConnection()) {
                if (!this.streamInfo) {
                    return;
                }
                const event = DeviceScreen.buildMotionEvent(e, this.streamInfo);
                if (event) {
                    this.ws.send(event.toBuffer());
                }
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            return true;
        };

        document.body.onmousedown = function(e) {
            down++;
            onMouseEvent(e);
        };
        document.body.onmouseup = function(e) {
            down--;
            onMouseEvent(e);
        };
        document.body.onmousemove = function(e) {
            if (down > 0) {
                onMouseEvent(e);
            }
        };
    }

    public getStreamInfo(): StreamInfo | undefined {
        return this.streamInfo;
    }

    public setStreamInfo(info: StreamInfo): void {
        this.streamInfo = info;
    }

    public sendEvent(event: ControlEvent): void {
        if (this.haveConnection()) {
            this.ws.send(event.toBuffer());
        }
    }

    public setErrorListener(listener: DeviceScreenErrorListener): void {
        this.errorListener = listener;
    }

    public stop(): void {
        if (this.haveConnection()) {
            this.ws.close()
        }
        if (this.converter) {
            this.converter.pause();
        }
    }
}