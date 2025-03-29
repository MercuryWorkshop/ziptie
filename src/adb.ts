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

import zipmouse from "../zipmouse.c?raw"
import zipstart from "../zipstart.sh?raw"
import server from "../release-0.0.0.apk?arraybuffer"
import { createFramer, mkstream } from './util';
let tmpdir = "/data/local/tmp";
export class AdbManager {
  jarWriter: WritableStreamDefaultWriter<MaybeConsumable<Uint8Array>> | undefined;
  mouseWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
  
  displayId: number = 0
  density: number = 150
  scrcpy: AdbScrcpyClient | undefined
  resolveCreateDisplay: ((value: unknown) => void) | undefined

  constructor(public adb: Adb, public fs: AdbSync) { }

  async startScrcpy() {
    this.sendCommand({ req: "createDisplay", width: window.innerWidth, height: window.innerHeight, density: this.density });
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
        let items = await navigator.clipboard.read();
        if (items.length == 0) return;
        let item = items[0];
        let clipboard;
        if (item.types.includes("text/plain")) {
          let blob = await item.getType("text/plain");
          clipboard = await blob.text();
        } else if (item.types.includes("image/png")) {
          let blob = await item.getType("image/png");
          let ab = await blob.arrayBuffer();
          let base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ab) as unknown as number[]));
          clipboard = `data:image/png;base64,${base64}`;
        } else {
          console.log("unsupported clipboard type", item.types);
          return;
        }
        if (clipboard == oldClipboard) return;
        if (clipboard.startsWith("data:")) {
          console.log("setting clipboard image", clipboard);
          this.sendCommand({ req: "setClipboardImage", uri: clipboard });
        } else {
          this.sendCommand({ req: "setClipboardText", text: clipboard });
        }
        oldClipboard = clipboard;
      } catch { }
    }, 500);

    let oldInnerWidth = window.innerWidth;
    let oldInnerHeight = window.innerHeight;
    setInterval(() => {
      if (window.innerWidth != oldInnerWidth || window.innerHeight != oldInnerHeight) {
        this.sendCommand({ req: "resizeDisplay", displayId: this.displayId, width: window.innerWidth, height: window.innerHeight, density: this.density });
        oldInnerHeight = window.innerHeight;
        oldInnerWidth = window.innerWidth;
      }
    }, 100);

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
      await this.termuxCmd(`sleep 1; cat pipe`);
      console.log("exited?");

      let socket = await this.adb.createSocket("tcp:12345");
      this.mouseWriter = socket.writable.getWriter() as any;

      // GALLIUM_DRIVER=virpipe MESA_GL_VERSION_OVERRIDE=4.0
      await this.termuxCmd("proot-distro login debian --shared-tmp -- PULSE_SERVER=127.0.0.1 DISPLAY=:0 startlxde");
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
    console.log("parseResponse", json);
    switch (json.req) {
      case "apps":
        state.apps = json.packageInfos;
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
  }

  async startLogcat() {
    const logcat = new Logcat(this.adb);
    logcat.binary().pipeTo(new WritableStream({
      write(packet) {
        if (packet.message.includes("Start server") || packet.tag.includes("Ziptie") || packet.tag.includes("scrcpy"))
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

    setTimeout(() => this.sendCommand({ req: "apps" }), 3000);
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
