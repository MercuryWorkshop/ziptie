import { AdbDaemonDevice, AdbPacket, AdbPacketSerializeStream } from "@yume-chan/adb";
import { MaybeConsumable, pipeFrom, ReadableStream, StructDeserializeStream, WrapReadableStream } from "@yume-chan/stream-extra";

declare const WebSocketStream: any;

export class AdbDaemonWebsocketDevice implements AdbDaemonDevice {
  static isSupported(): boolean {
    return true;
  }

  readonly serial: string;

  get name(): string | undefined {
    return this.address;
  }

  constructor(private address: string) {
    this.serial = address;
  }

  async connect() {
    const socket = new WebSocketStream(this.address);
    const { readable, writable } = await socket.opened;
    let writer = writable.getWriter();
    const reader = readable.getReader();


    return {
      readable: new WrapReadableStream(new ReadableStream({
        pull(controller) {
          reader.read().then(({ value, done }: any) => {
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(value));
          });
        }
      })).pipeThrough(new StructDeserializeStream(AdbPacket) as any),
      writable: pipeFrom(
        new MaybeConsumable.WritableStream({
          write(packet: any) {
            writer.write(packet);
          },
          close() {
            writable.close();
          },
        }),
        new AdbPacketSerializeStream(),
      )
    } as any;
  }
}
