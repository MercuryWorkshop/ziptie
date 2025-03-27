import { Adb, AdbDaemonDevice, AdbDaemonTransport, AdbPacket, AdbPacketSerializeStream, AdbServerClient, AdbServerTransport, AdbSubprocessNoneProtocol, AdbSubprocessProtocol, AdbSubprocessShellProtocol, AdbSubprocessWaitResult } from '@yume-chan/adb';

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyExitedError, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath, AndroidKeyCode, AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyAudioCodec } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { AndroidKeyEventAction, ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

import { CodecOptions, Crop } from '@yume-chan/scrcpy/esm/1_17/impl';
import { MaybeConsumable, MaybeConsumable, pipeFrom, PushReadableStream, ReadableStream, StructDeserializeStream, WrapReadableStream, WrapWritableStream } from '@yume-chan/stream-extra';
import { Logcat, AndroidLogEntry } from '@yume-chan/android-bin';

export enum VirtualDisplayMode {
  None,
  Internal,
  Shell,
}
export const VIRTUAL_DISPLAY_MODE: VirtualDisplayMode = VirtualDisplayMode.Internal;


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

export let adb: Adb;

declare const WebSocketStream: any;

class AdbDaemonWebsocketDevice implements AdbDaemonDevice {
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

export async function connectAdb() {
  Manager.trackDevices();

  let devices = await Manager.getDevices();
  let device: AdbDaemonWebUsbDevice | undefined;
  if (devices.length == 1) {
    device = devices[0];
  } else {
    device = await Manager.requestDevice();
    if (!device) {
      throw new Error("No device selected");
    }
  }
  let connection = await connect(device);

  // const device = new AdbDaemonWebsocketDevice("ws://10.0.1.163:8080");
  // let connection = await device.connect();

  console.log("connected");

  const CredentialStore: AdbWebCredentialStore = new AdbWebCredentialStore("skibidi");
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: CredentialStore
  });
  console.log("authenticated");
  adb = new Adb(transport);
  window.adb = adb;
}

export async function getDisplayIds(): Promise<number[]> {
  let displayinfo = await adb.subprocess.spawnAndWait(["dumpsys", "display"]);
  console.log(displayinfo);

  let selector = /mDisplayId=(\d+)/g;

  let unique = new Set<number>();
  let match;

  do {
    match = selector.exec(displayinfo.stdout);
    if (match) {
      unique.add(parseInt(match[1]));
    }
  } while (match);
  return Array.from(unique);
}
export let gDisplayId = -1;

export async function startScrcpy(mount: HTMLElement): Promise<AdbScrcpyClient> {
  console.log(VERSION); // 2.1
  const server = await fetch(BIN);
  await AdbScrcpyClient.pushServer(adb, server.body as any);


  let opts: ScrcpyOptions3_1.Init = {
    stayAwake: true,
    videoBitRate: 10000,
    clipboardAutosync: true,
    control: true,
    audio: true,

    videoCodecOptions: new CodecOptions({
      level: 1,
      iFrameInterval: 10000,
    })
  };

  if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.Shell) {
    // create virtual displays the official way
    opts.newDisplay = `${window.innerWidth}x${window.innerHeight}`;
  } else if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.Internal) {
    // VIRTUAL_DISPLAY_FLAG_TRUSTED was revoked from adb shell in android 15
    // create virtual displays by abusing overlay_display_devices

    if ((await adb.subprocess.spawnAndWait(["settings", "put", "global", "overlay_display_devices", "null"])).exitCode != 0) throw new Error("fail");
    let oldDisplayIds = await getDisplayIds();

    // create an overlay with a very small size so that it doesn't interfere with the main display too much
    // JANK JANK JANK todo figure out what numbers it accepts
    if ((await adb.subprocess.spawnAndWait(["settings", "put", "global", "overlay_display_devices", "900x300/600"])).exitCode != 0) throw new Error("fail");
    let displayIds = await getDisplayIds();
    let newDisplayIds = displayIds.filter(x => !oldDisplayIds.includes(x));
    if (newDisplayIds.length != 1) throw new Error("something went wrong creating screens");
    let displayId = newDisplayIds[0];
    console.log("displayId", displayId);
    gDisplayId = displayId;

    // after creating we can resize it and it won't change the overlay size
    await adb.subprocess.spawnAndWait(["wm", "size", `${window.innerWidth}x${window.innerHeight}`, "-d", displayId.toString()]);
    await adb.subprocess.spawnAndWait(["wm", "density", "150", "-d", displayId.toString()]);

    // systemui doesn't run on these displays for some reason
    await adb.subprocess.spawnAndWait(["am", "start", "-n", "com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "--display", displayId.toString()]);

    opts.displayId = displayId;
  } else if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.None) {
    // use the main display
    await adb.subprocess.spawnAndWait(["wm", "reset"]);
    await adb.subprocess.spawnAndWait(["wm", "size", `${window.innerWidth}x${window.innerHeight}`]);
    await adb.subprocess.spawnAndWait(["wm", "density", "150"]);
  }


  const options = new AdbScrcpyOptions2_1(
    new ScrcpyOptions3_1(opts)
  );

  let client;
  try {
    client = await AdbScrcpyClient.start(
      adb,
      DefaultServerPath,
      options
    );
  } catch (e: any) {
    console.log(e.output)
    throw e;
  }

  options.clipboard?.pipeTo(
    new WritableStream({
      write(packet: string) {
        navigator.clipboard.writeText(packet);
      }
    }) as any
  );

  let oldClipboard = "";
  setInterval(async () => {
    try {
      let clipboard = await navigator.clipboard.readText();
      if (clipboard == oldClipboard) return;
      client.controller!.setClipboard({
        sequence: 0n,
        paste: false,
        content: clipboard,
      });
      oldClipboard = clipboard;
    } catch { }
  }, 500);


  return client;
}

export async function termuxCmdWait(cmd: string): Promise<AdbSubprocessWaitResult> {
  return await adb.subprocess.spawnAndWait(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
}

export function logProcess(process: AdbSubprocessProtocol) {
  let stdout_pending_data = "";
  let stderr_pending_data = "";
  process.stdout.pipeTo(new WritableStream({
    write(packet) {
      let data = new TextDecoder().decode(packet);
      let lines = (stdout_pending_data + data).split("\n");
      stdout_pending_data = lines.pop()!;
      for (let line of lines) {
        console.log(line);
      }
    }
  }) as any);

  process.stderr.pipeTo(new WritableStream({
    write(packet) {
      let data = new TextDecoder().decode(packet);
      let lines = (stderr_pending_data + data).split("\n");
      stderr_pending_data = lines.pop()!;
      for (let line of lines) {
        console.error(line);
      }
    }
  }) as any);
}

export async function prootCmd(cmd: string): Promise<number> {
  return await termuxCmd(`proot-distro login debian --shared-tmp -- ${cmd}`);
}
export async function termuxCmd(cmd: string): Promise<number> {
  let a = await adb.subprocess.spawn(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
  logProcess(a);
  return await a.exit;
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
