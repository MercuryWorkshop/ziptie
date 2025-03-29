import { MaybeConsumable } from "@yume-chan/stream-extra";

export function mkstream(text: string | Uint8Array): any {
  let uint8array = text instanceof Uint8Array ? text : new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(uint8array);
      controller.close();
    }
  });
}


export function createFramer(): TransformStream<Uint8Array, Uint8Array> {
  let currentPacket = new Uint8Array();
  let currentSize = -1;
  return new TransformStream({
    transform(chunk, controller) {
      currentPacket = new Uint8Array([...currentPacket, ...chunk]);
      while (true) {
        if (currentSize === -1) {
          if (currentPacket.length < 4) {
            break;
          }
          let size: number;
          try {
            let dv = new DataView(currentPacket.buffer);
            size = dv.getUint32(0);
          } catch (err) {
            break;
          }
          currentSize = size;
          currentPacket = currentPacket.slice(4);
        }

        if (currentPacket.length < currentSize) {
          // too small, don't do anything
          break;
        }

        const pkt = currentPacket.slice(0, currentSize);
        controller.enqueue(pkt);
        currentPacket = currentPacket.slice(currentSize);
        currentSize = -1;
      }
    },
  });
}
