import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import './style.css'

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

async function connect(device: AdbDaemonWebUsbDevice) {
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
window.fp = Float32PcmPlayer;

document.getElementById("button")!.addEventListener("click", async () => {
  const device: AdbDaemonWebUsbDevice | undefined = await Manager.requestDevice();
  if (!device) {
    alert("No device selected");
    return;
  }

  let connection = await connect(device);
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: CredentialStore
  });

  const adb = new Adb(transport);

  console.log(VERSION); // 2.1
  const server = await fetch(BIN);
  await AdbScrcpyClient.pushServer(adb, server.body as any);




  const options = new AdbScrcpyOptions2_1(
    new ScrcpyOptions3_1({
      stayAwake: true,
      newDisplay: "1920x1080",
      // Uncomment for codec settings
      // codecOptions: new CodecOptions({
      //   profile: H264Capabilities.maxProfile,
      //   level: H264Capabilities.maxLevel,
      // }),
    })
  );

  const client = await AdbScrcpyClient.start(
    adb,
    DefaultServerPath,
    options
  );

  const { metadata: videoMetadata, stream: videoPacketStream } = await client.videoStream;

  const renderer = createVideoFrameRenderer();
  document.getElementById("container")!.appendChild(renderer.element);
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
  controller.startApp("com.termux.x11");

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
  function injectTouch(e: PointerEvent) {
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
    } else {
      switch (type) {
        case 'pointerdown':
          action = AndroidMotionEventAction.Down
          break
        case 'pointermove':
          if (buttons === 0) {
            action = AndroidMotionEventAction.HoverMove
          } else {
            action = AndroidMotionEventAction.Move
          }
          break
        case 'pointerup':
          action = AndroidMotionEventAction.Up;
          console.log("SENDING POINTER UP???");
          break
        default:
          throw new Error(`Unsupported event type: ${type}`)
      }
      controller.injectTouch({
        action,
        pointerId: BigInt(e.pointerId),
        ...getPointer(video, clientX, clientY),
        pressure: buttons === 0 ? 0 : 1,
        actionButton: PointerEventButtonToAndroidButton[button],
        buttons,
      })
    }
  }

  document.body.addEventListener("keydown", injectKeyCode as any);
  document.body.addEventListener("keyup", injectKeyCode as any);
  video.addEventListener("wheel", injectScroll as any);
  video.addEventListener("pointerdown", injectTouch as any);
  video.addEventListener("pointermove", injectTouch as any);
  video.addEventListener("pointerup", injectTouch as any);
  video.setAttribute('tabindex', '0');
  video.focus();

  window.c = controller;


  let chrootdir = "/data/local/linux";
  window.startx = async () => {
    let shell = await adb.subprocess.shell("run-as com.termux files/usr/bin/bash -lic 'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; bash -i'");
    let writer = shell.stdin.getWriter();
    shell.stdout.pipeTo(new WritableStream({
      write(packet: string) {
        console.log(packet);
      }
    }) as any);
    shell.stderr.pipeTo(new WritableStream({
      write(packet: string) {
        console.error(packet);
      }
    }) as any);
    let te = new TextEncoder();


    // if external chroot
    // writer.write(te.encode(`export TMPDIR=${chrootdir}/tmp\n`));
    // writer.write(te.encode("export CLASSPATH=$(/system/bin/pm path com.termux.x11 | cut -d: -f2)\n"));
    // writer.write(te.encode("/system/bin/app_process / --nice-name=termux-x11 com.termux.x11.CmdEntryPoint :0\n"));

    writer.write(te.encode("termux-x11 :0\n"));
  };

});
