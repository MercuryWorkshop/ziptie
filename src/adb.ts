import { Adb, AdbDaemonDevice, AdbDaemonTransport, AdbPacket, AdbPacketSerializeStream, AdbServerClient, AdbServerTransport, AdbSubprocessNoneProtocol, AdbSubprocessProtocol, AdbSubprocessShellProtocol, AdbSubprocessWaitResult, AdbSync } from '@yume-chan/adb';

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyExitedError, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath, AndroidKeyCode, AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyAudioCodec } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { AndroidKeyEventAction, ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

import { CodecOptions, Crop } from '@yume-chan/scrcpy/esm/1_17/impl';
import { MaybeConsumable, pipeFrom, PushReadableStream, ReadableStream, StructDeserializeStream, WrapReadableStream, WrapWritableStream } from '@yume-chan/stream-extra';
import { Logcat, AndroidLogEntry } from '@yume-chan/android-bin';
import { debug, mgr, state } from './main';

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

export let gDisplayId = -1;

// export async function startScrcpy(mount: HTMLElement): Promise<AdbScrcpyClient> {
//
//
//   if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.Shell) {
//     // create virtual displays the official way
//     opts.newDisplay = `${window.innerWidth}x${window.innerHeight}`;
//   } else if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.Internal) {
//     // VIRTUAL_DISPLAY_FLAG_TRUSTED was revoked from adb shell in android 15
//     // create virtual displays by abusing overlay_display_devices
//
//     if ((await adb.subprocess.spawnAndWait(["settings", "put", "global", "overlay_display_devices", "null"])).exitCode != 0) throw new Error("fail");
//     let oldDisplayIds = await getDisplayIds();
//
//     // create an overlay with a very small size so that it doesn't interfere with the main display too much
//     // JANK JANK JANK todo figure out what numbers it accepts
//     if ((await adb.subprocess.spawnAndWait(["settings", "put", "global", "overlay_display_devices", "900x300/600"])).exitCode != 0) throw new Error("fail");
//     let displayIds = await getDisplayIds();
//     let newDisplayIds = displayIds.filter(x => !oldDisplayIds.includes(x));
//     if (newDisplayIds.length != 1) throw new Error("something went wrong creating screens");
//     let displayId = newDisplayIds[0];
//     console.log("displayId", displayId);
//     gDisplayId = displayId;
//
//     // after creating we can resize it and it won't change the overlay size
//     await adb.subprocess.spawnAndWait(["wm", "size", `${window.innerWidth}x${window.innerHeight}`, "-d", displayId.toString()]);
//     await adb.subprocess.spawnAndWait(["wm", "density", "150", "-d", displayId.toString()]);
//
//     // systemui doesn't run on these displays for some reason
//     await adb.subprocess.spawnAndWait(["am", "start", "-n", "com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "--display", displayId.toString()]);
//
//     opts.displayId = displayId;
//   } else if (VIRTUAL_DISPLAY_MODE == VirtualDisplayMode.None) {
//     // use the main display
//     await adb.subprocess.spawnAndWait(["wm", "reset"]);
//     await adb.subprocess.spawnAndWait(["wm", "size", `${window.innerWidth}x${window.innerHeight}`]);
//     await adb.subprocess.spawnAndWait(["wm", "density", "150"]);
//   }
//   return client;
// }


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
  // let a = await adb.subprocess.spawn(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
  // logProcess(a);
  // return await a.exit;
}

export async function termuxShell(cmd: string = "run-as com.termux files/usr/bin/bash -lic 'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; bash -i'"): Promise<(cmd: string) => Promise<void>> {
  // let shell = await adb.subprocess.shell(cmd);
  // let writer = shell.stdin.getWriter();
  // shell.stdout.pipeTo(new WritableStream({
  //   write(packet) {
  //     console.log(new TextDecoder().decode(packet));
  //   }
  // }) as any);
  // shell.stderr.pipeTo(new WritableStream({
  //   write(packet) {
  //     console.error(new TextDecoder().decode(packet));
  //   }
  // }) as any);
  // let te = new TextEncoder();
  //
  // return async (cmd: string) => {
  //   writer.write(te.encode(cmd));
  // }
}

import zipmouse from "../zipmouse.c?raw"
import zipstart from "../zipstart.sh?raw"
import server from "../release-0.0.0.apk?arraybuffer"
import { createFramer, mkstream } from './util';
let tmpdir = "/data/local/tmp";
export class AdbManager {
  jarWriter: WritableStreamDefaultWriter<MaybeConsumable<Uint8Array>> | undefined;
  mouseWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
  
  displayId: number = 0
  scrcpy: AdbScrcpyClient | undefined
  resolveCreateDisplay: ((value: unknown) => void) | undefined

  constructor(public adb: Adb, public fs: AdbSync) { }

  async startScrcpy() {
    this.sendCommand({ req: "createDisplay", width: window.innerWidth, height: window.innerHeight, density: 150 });
    await new Promise(resolve => this.resolveCreateDisplay = resolve);

    const server = await fetch(BIN);
    await AdbScrcpyClient.pushServer(this.adb, server.body as any);


    let opts: ScrcpyOptions3_1.Init = {
      stayAwake: true,
      videoBitRate: 10000,
      clipboardAutosync: true,
      control: true,
      audio: true,
      displayId: this.displayId,
      videoCodecOptions: new CodecOptions({
        level: 1,
        iFrameInterval: 10000,
      })
    };


    const options = new AdbScrcpyOptions2_1(
      new ScrcpyOptions3_1(opts)
    );

    try {
      this.scrcpy = await AdbScrcpyClient.start(
        this.adb,
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
        this.scrcpy!.controller!.setClipboard({
          sequence: 0n,
          paste: false,
          content: clipboard,
        });
        oldClipboard = clipboard;
      } catch { }
    }, 500);

  }

  async startX11() {
      await this.fs.write({
        filename: tmpdir + "/zipmouse.c",
        file: mkstream(zipmouse)
      })
      await this.fs.write({
        filename: tmpdir + "/zipstart.sh",
        file: mkstream(zipstart)
      });
      await this.termuxCmd(`rm pipe; mkfifo pipe; sleep 2`);
      this.termuxCmd(`bash ${tmpdir}/zipstart.sh`);
      await this.termuxCmd(`sleep 5; cat pipe`);
      console.log("exited?");

      let socket = await this.adb.createSocket("tcp:12345");
      this.mouseWriter = socket.writable.getWriter() as any;

      // GALLIUM_DRIVER=virpipe MESA_GL_VERSION_OVERRIDE=4.0
      prootCmd("PULSE_SERVER=127.0.0.1 DISPLAY=:0 startlxde");
  }

  async termuxCmd(cmd: string): Promise<number> {
    let e = await this.adb.subprocess.spawn(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
    logProcess(e);
    return await e.exit;
  }

  async writeMouseCmd(bytes: number[]) {
    if (!this.mouseWriter) throw new Error("mouse writer not open");
    await this.mouseWriter.write(new Uint8Array(Uint32Array.from(bytes).buffer));
  }

  async openApp(packageName: string) {
    await this.sendCommand({ req: "launch", packageName, displayId: this.displayId });
  }

  async setSetting(namespace: string, key: string, value: string) {
    await this.sendCommand({ req: "setSetting", namespace, key, value });
  }

  async sendCommand(json: any) {
    if (!this.jarWriter) throw new Error("socket not open");
    let text = new TextEncoder().encode(JSON.stringify(json));
    let ab = new Uint8Array(text.length + 4);
    let dv = new DataView(ab.buffer);
    dv.setUint32(0, text.length);
    ab.set(text, 4);
    this.jarWriter.write(ab);
  }

  async parseResponse(json: any) {
    console.log(json);
    switch (json.req) {
      case "apps":
        state.apps = json.data.packageInfos;
        break;
      case "openapps":
        state.openApps = json.data;
        break;
      case "createDisplay":
        console.log("createDisplay", json.displayId);
        this.displayId = json.displayId;
        this.resolveCreateDisplay!(json);
        break;
    }
    console.log(json);
  }

  async startLogcat() {
    const logcat = new Logcat(this.adb);
    logcat.binary().pipeTo(new WritableStream({
      write(packet) {
        if (packet.message.includes("Start server") || packet.tag.includes("Ziptie"))
          console.log(packet.message);
      }
    }) as any);
  }

  async startNative() {
    await this.fs.write({
      filename: tmpdir + "/server.apk",
      file: mkstream(server)
    });
    let e = await this.adb.subprocess.shell(["sh", "-c", `echo "if i remove this echo it breaks" && CLASSPATH=${tmpdir}/server.apk app_process /system/bin org.mercuryworkshop.ziptie.Server`]);
    logProcess(e);
    await new Promise(resolve => setTimeout(resolve, 1000));
    let socket = await this.adb.createSocket("localabstract:ziptie");
    this.jarWriter = socket.writable.getWriter();
    let td = new TextDecoder();
    let t = this;
    socket.readable.pipeThrough(createFramer() as any).pipeTo(new WritableStream({
      write(packet) {
        let resp = JSON.parse(td.decode(packet));
        t.parseResponse(resp);
      }
    }) as any);
  }

  static async connect() {
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
    let adb = new Adb(transport);
    debug.adb = adb;
    let fs = await adb.sync();
    return new AdbManager(adb, fs);
  }
}
