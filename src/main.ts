import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import './style.css'

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath, AndroidKeyCode, AndroidMotionEventAction } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import type { VideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
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
  let a = await client.audioStream!;
  if (a.type != "success") throw new Error("Audio stream failed");
  a.stream.pipeTo(new WritableStream({
    write(packet: ScrcpyMediaStreamPacket) {
    }
  }) as any);

  const controller = client.controller!;
  controller.startApp("com.termux.x11");

  let screenWidth = 0;
  let screenHeight = 0;

  decoder.sizeChanged(({ width, height }) => {
    screenWidth = width;
    screenHeight = height;
  });

  document.body.addEventListener("keydown", (event: KeyboardEvent) => {
    console.log(controller, event);
    controller.injectKeyCode({
      action: 0,
      keyCode: Object.fromEntries(Object.entries(AndroidKeyCode))[event.code],
      repeat: 0,
    });
    event.preventDefault();
  });
  document.body.addEventListener("keyup", (event: KeyboardEvent) => {
    controller.injectKeyCode({
      action: 1,
      keyCode: Object.fromEntries(Object.entries(AndroidKeyCode))[event.code],
      repeat: 0,
    });
    event.preventDefault();
  });
  document.body.addEventListener("mousedown", (event: MouseEvent) => {
    console.log(controller, event);
    let rect = renderer.element.getBoundingClientRect();
    let relativeX = (event.clientX - rect.left) * screenWidth / rect.width;
    let relativeY = (event.clientY - rect.top) * screenHeight / rect.height;

    controller.injectTouch({
      action: AndroidMotionEventAction.Down,
      pointerId: 0n,
      pointerX: relativeX,
      pointerY: relativeY,
      screenWidth,
      screenHeight,
      pressure: 1,
    });
    event.preventDefault();
  });
  document.body.addEventListener("mouseup", (event: MouseEvent) => {
    controller.injectTouch({
      action: AndroidMotionEventAction.Up,
      pointerId: 0n,
      pointerX: event.clientX,
      pointerY: event.clientY,
      screenWidth,
      screenHeight,
      pressure: 1,
    });
    event.preventDefault();
  });
  document.body.addEventListener("mousemove", (event: MouseEvent) => {
    let rect = renderer.element.getBoundingClientRect();
    let relativeX = (event.clientX - rect.left) * screenWidth / rect.width;
    let relativeY = (event.clientY - rect.top) * screenHeight / rect.height;

    controller.injectTouch({
      action: 2,
      pointerId: 0n,
      pointerX: relativeX,
      pointerY: relativeY,
      screenWidth,
      screenHeight,
      pressure: 1,
      // actionButton: u32,
      // buttons: u32,
    });
    event.preventDefault();
  });
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
  }

});
