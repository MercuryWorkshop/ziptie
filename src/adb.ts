import { Adb, AdbDaemonTransport } from '@yume-chan/adb';

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath, AndroidKeyCode, AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyAudioCodec } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { AndroidKeyEventAction, ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import { VideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
import { Float32PcmPlayer } from '@yume-chan/pcm-player'
import {
  InsertableStreamVideoFrameRenderer,
  WebGLVideoFrameRenderer,
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { CodecOptions } from '@yume-chan/scrcpy/esm/1_17/impl';

function createVideoFrameRenderer(): {
  renderer: VideoFrameRenderer;
  element: HTMLVideoElement | HTMLCanvasElement;
} {
  if (InsertableStreamVideoFrameRenderer.isSupported) {
    const renderer = new InsertableStreamVideoFrameRenderer();
    return { renderer, element: renderer.element };
  }

  if (WebGLVideoFrameRenderer.isSupported) {
    const renderer = new WebGLVideoFrameRenderer();
    return { renderer, element: renderer.canvas as HTMLCanvasElement };
  }

  const renderer = new BitmapVideoFrameRenderer();
  return { renderer, element: renderer.canvas as HTMLCanvasElement };
}

const CredentialStore: AdbWebCredentialStore = new AdbWebCredentialStore();

const Manager: AdbDaemonWebUsbDeviceManager = new AdbDaemonWebUsbDeviceManager(navigator.usb);

export async function connect(device: AdbDaemonWebUsbDevice) {
  try {
    return await device.connect();
  } catch (error) {
    if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
      alert(
        "The device is already in use by another program. Please close the program and try again.",
      );
    }
    // It might also throw other errors
    throw error;
  }
}

export class OpusStream extends TransformStream<
  ScrcpyMediaStreamPacket,
  Float32Array
> {
  constructor(config: AudioDecoderConfig) {
    let decoder: AudioDecoder

    super({
      start(controller) {
        decoder = new AudioDecoder({
          error(error) {
            console.error('audio decoder error', error)
            controller.error(error)
          },
          output(output) {
            const options: AudioDataCopyToOptions = {
              format: 'f32',
              planeIndex: 0,
            }
            const buffer = new Float32Array(
              output.allocationSize(options) / Float32Array.BYTES_PER_ELEMENT
            )
            output.copyTo(buffer, options)
            controller.enqueue(buffer)
          },
        })
        decoder.configure(config)
      },
      transform(chunk: any) {
        switch (chunk.type) {
          case 'data':
            if (chunk.data.length === 0) {
              break
            }
            decoder.decode(
              new EncodedAudioChunk({
                type: 'key',
                timestamp: 0,
                data: chunk.data,
              })
            )
        }
      },
      async flush() {
        await decoder.flush()
      },
    })
  }
}

let adb: Adb;
export let displayId;

export async function connectAdb() {
  const device: AdbDaemonWebUsbDevice | undefined = await Manager.requestDevice();
  if (!device) {
    throw new Error("No device selected");
  }

  let connection = await connect(device);
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: CredentialStore
  });
  adb = new Adb(transport);
}

export async function startScrcpy(mount: HTMLElement): Promise<AdbScrcpyClient> {

  console.log(VERSION); // 2.1
  const server = await fetch(BIN);
  await AdbScrcpyClient.pushServer(adb, server.body as any);


  const options = new AdbScrcpyOptions2_1(
    new ScrcpyOptions3_1({
      stayAwake: true,
      // listApps: true,
      // newDisplay: "1920x1080",
      newDisplay: `${window.innerWidth}x${window.innerHeight}`,
      // Uncomment for codec settings
      videoCodecOptions: new CodecOptions({
        profile: 10,
        level: 10,
        iFrameInterval: 10000,
      }),
    })
  );

  const client = await AdbScrcpyClient.start(
    adb,
    DefaultServerPath,
    options
  );

  const { metadata: videoMetadata, stream: videoPacketStream } = await client.videoStream;

  const renderer = createVideoFrameRenderer();
  mount.appendChild(renderer.element);
  const decoder = new WebCodecsVideoDecoder({
    codec: videoMetadata.codec,
    renderer: renderer.renderer,
  });

  videoPacketStream.pipeTo(decoder.writable).catch((error) => {
    console.error(error);
  });
  client.stdout.pipeTo(new WritableStream({
    write(packet: string) {
      console.log(packet);
      const match = packet.match(/\(id=(\d+)\)/);

      if (match && match.length > 1) {
        displayId = match[1];
        console.log('displayId', displayId);
      }
    }
  }) as any);
  let metadata = await client.audioStream!;
  if (metadata.type != "success") throw new Error("Audio stream failed");
  const [recordStream, playbackStream] = metadata.stream.tee();
  let player: any;
  if (metadata.codec === ScrcpyAudioCodec.Raw) {
    console.info('audio codec raw')
  } else if (metadata.codec === ScrcpyAudioCodec.Opus) {
    console.info('audio codec opus')
    player = new Float32PcmPlayer(48000, 2)
    playbackStream
      .pipeThrough(
        new OpusStream({
          codec: metadata.codec.webCodecId,
          numberOfChannels: 2,
          sampleRate: 48000,
        }) as any
      )
      .pipeTo(
        new WritableStream({
          write: (chunk) => {
            player.feed(chunk)
          },
        }) as any
      )

    player.start();
  }

  const controller = client.controller!;

  let screenWidth = 0;
  let screenHeight = 0;

  decoder.sizeChanged(({ width, height }) => {
    screenWidth = width;
    screenHeight = height;
  });

  let video = renderer.element as HTMLVideoElement;

  function injectKeyCode(e: KeyboardEvent) {
    // if (e.target != video) return;
    console.log(e);
    e.preventDefault()
    e.stopPropagation()

    const { type, code } = e

    let action: AndroidKeyEventAction;
    switch (type) {
      case 'keydown':
        action = AndroidKeyEventAction.Down;
        break
      case 'keyup':
        action = AndroidKeyEventAction.Up;
        break
      default:
        throw new Error(`Unsupported event type: ${type}`)
    }

    const keyCode = AndroidKeyCode[code as keyof typeof AndroidKeyCode]

    controller.injectKeyCode({
      action,
      keyCode,
      repeat: 0,
      metaState: 0,
    });
  }
  function getPointer(el: HTMLVideoElement, clientX: number, clientY: number) {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
    const screenWidth = el.width
    const screenHeight = el.height

    const rect = el.getBoundingClientRect()

    const videoRect = {
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    }
    if (screenWidth / screenHeight < rect.width / rect.height) {
      videoRect.height = rect.height
      videoRect.width = videoRect.height * (screenWidth / screenHeight)
      videoRect.x = rect.x + (rect.width - videoRect.width) / 2
      videoRect.y = rect.y
    } else {
      videoRect.width = rect.width
      videoRect.height = videoRect.width * (screenHeight / screenWidth)
      videoRect.x = rect.x
      videoRect.y = rect.y + (rect.height - videoRect.height) / 2
    }

    const percentageX = clamp((clientX - videoRect.x) / videoRect.width, 0, 1)
    const percentageY = clamp((clientY - videoRect.y) / videoRect.height, 0, 1)

    const pointerX = percentageX * screenWidth
    const pointerY = percentageY * screenHeight

    return {
      screenWidth,
      screenHeight,
      pointerX,
      pointerY,
    }
  }

  let reportdesc = [
    // Usage Page (Generic Desktop)
    0x05, 0x01,
    // Usage (Mouse)
    0x09, 0x02,

    // Collection (Application)
    0xA1, 0x01,

    // Usage (Pointer)
    0x09, 0x01,

    // Collection (Physical)
    0xA1, 0x00,

    // Usage Page (Buttons)
    0x05, 0x09,

    // Usage Minimum (1)
    0x19, 0x01,
    // Usage Maximum (5)
    0x29, 0x05,
    // Logical Minimum (0)
    0x15, 0x00,
    // Logical Maximum (1)
    0x25, 0x01,
    // Report Count (5)
    0x95, 0x05,
    // Report Size (1)
    0x75, 0x01,
    // Input (Data, Variable, Absolute): 5 buttons bits
    0x81, 0x02,

    // Report Count (1)
    0x95, 0x01,
    // Report Size (3)
    0x75, 0x03,
    // Input (Constant): 3 bits padding
    0x81, 0x01,

    // Usage Page (Generic Desktop)
    0x05, 0x01,
    // Usage (X)
    0x09, 0x30,
    // Usage (Y)
    0x09, 0x31,
    // Usage (Wheel)
    0x09, 0x38,
    // Logical Minimum (-127)
    0x15, 0x81,
    // Logical Maximum (127)
    0x25, 0x7F,
    // Report Size (8)
    0x75, 0x08,
    // Report Count (3)
    0x95, 0x03,
    // Input (Data, Variable, Relative): 3 position bytes (X, Y, Wheel)
    0x81, 0x06,

    // End Collection
    0xC0,

    // End Collection
    0xC0
  ];
  let hidmouse = await controller.uHidCreate({
    id: 0x2,
    vendorId: 0,
    productId: 0,
    name: null,
    data: reportdesc,
  })
  function injectScroll(e: WheelEvent) {
    e.preventDefault()
    e.stopPropagation()

    controller.injectScroll({
      ...getPointer(video, e.clientX, e.clientY),
      scrollX: -e.deltaX / 100,
      scrollY: -e.deltaY / 100,
      buttons: 0,
    })
  };
  let isdragging = false;
  async function injectTouch(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()


    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    const { type, clientX, clientY, button, buttons } = e

    const PointerEventButtonToAndroidButton = [
      AndroidMotionEventButton.Primary,
      AndroidMotionEventButton.Tertiary,
      AndroidMotionEventButton.Secondary,
      AndroidMotionEventButton.Back,
      AndroidMotionEventButton.Forward,
    ]

    let action: AndroidMotionEventAction;
    let useTracking = false;
    if (useTracking) {
      let data: number[] = [];
      if (type === "pointermove") {
        // raw hid data
        data = [
          0x00, // buttons
          Math.random() * 255 - 128, // x
          Math.random() * 255 - 128, // y
          0x00, // wheel
          0x00, // wheel
          0x00, // wheel
          0x00, // wheel
        ];
      }

      controller.uHidInput({
        id: 0x2,
        data,
      })
    } else {
      switch (type) {
        case 'pointerdown':
          await controller.injectTouch({
            action: AndroidMotionEventAction.Down,
            pointerId: BigInt(e.pointerId),
            ...getPointer(video, clientX, clientY),
            actionButton: PointerEventButtonToAndroidButton[button],
            pressure: 1.0,
            buttons,
          });
          break
        case 'pointermove':
          await controller.injectTouch({
            action: AndroidMotionEventAction.Move,
            pointerId: BigInt(e.pointerId),
            ...getPointer(video, clientX, clientY),
            pressure: 1.0,
            buttons,
          });
          break
        case 'pointerup':
          await controller.injectTouch({
            action: AndroidMotionEventAction.Up,
            pointerId: BigInt(e.pointerId),
            ...getPointer(video, clientX, clientY),
            pressure: 0,
            actionButton: PointerEventButtonToAndroidButton[button],
            buttons,
          });
          break;
        case 'contextmenu':
          await controller.injectTouch({
            action: AndroidMotionEventAction.Down,
            pointerId: BigInt(e.pointerId),
            ...getPointer(video, clientX, clientY),
            actionButton: AndroidMotionEventButton.Secondary,
            pressure: 1.0,
            buttons,
          });
          await controller.injectTouch({
            action: AndroidMotionEventAction.Up,
            pointerId: BigInt(e.pointerId),
            ...getPointer(video, clientX, clientY),
            pressure: 0,
            actionButton: AndroidMotionEventButton.Secondary,
            buttons,
          });
          break;
        default:
          throw new Error(`Unsupported event type: ${type}`)
      }
    }
  }


  document.body.addEventListener("keydown", injectKeyCode as any);
  document.body.addEventListener("keyup", injectKeyCode as any);
  video.addEventListener("wheel", injectScroll as any);
  video.addEventListener("pointerdown", injectTouch as any);
  video.addEventListener("pointermove", injectTouch as any);
  video.addEventListener("pointerup", injectTouch as any);
  video.addEventListener("contextmenu", injectTouch as any);
  video.setAttribute('tabindex', '0');
  video.focus();

  return client;
}

export async function termuxShell(cmd: string = "run-as com.termux files/usr/bin/bash -lic 'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; bash -i'"): Promise<(cmd: string) => Promise<void>> {
  let shell = await adb.subprocess.shell(cmd);
  let writer = shell.stdin.getWriter();
  shell.stdout.pipeTo(new WritableStream({
    write(packet) {
      console.log(new TextDecoder().decode(packet));
    }
  }) as any);
  shell.stderr.pipeTo(new WritableStream({
    write(packet) {
      console.error(new TextDecoder().decode(packet));
    }
  }) as any);
  let te = new TextEncoder();

  return async (cmd: string) => {
    writer.write(te.encode(cmd));
  }
}
