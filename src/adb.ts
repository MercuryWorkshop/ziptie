import { Adb, AdbDaemonDevice, AdbDaemonTransport, AdbSubprocessProtocol, AdbSync } from '@yume-chan/adb';

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN } from "@yume-chan/fetch-scrcpy-server";

import { CodecOptions } from '@yume-chan/scrcpy/esm/1_17/impl';
import { MaybeConsumable } from '@yume-chan/stream-extra';
import { Logcat } from '@yume-chan/android-bin';
import { debug, state, store } from './main';

export enum VirtualDisplayMode {
  None,
  Internal,
  Shell,
}
export const VIRTUAL_DISPLAY_MODE: VirtualDisplayMode = VirtualDisplayMode.Internal;

// @ts-ignore
const Manager: AdbDaemonWebUsbDeviceManager = new AdbDaemonWebUsbDeviceManager(navigator.usb);

export async function connect(device: AdbDaemonWebUsbDevice) {
  try {
    return await device.connect();
  } catch (error) {
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
// @ts-ignore
import server from "../release-0.0.0.apk?arraybuffer"
import { createFramer, mkstream } from './util';
let tmpdir = "/data/local/tmp";
export class AdbManager {
  jarWriter: WritableStreamDefaultWriter<MaybeConsumable<Uint8Array>> | undefined;
  mouseWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;

  displayId: number = 0
  density: number = 0
  scrcpy: AdbScrcpyClient | undefined
  resolveCreateDisplay: ((value: unknown) => void) | undefined

  constructor(public adb: Adb, public fs: AdbSync) { }

  async startScrcpy(content: HTMLElement, density: number) {
    density = parseInt(density.toString());
    this.density = density;
    this.sendCommand({ req: "createDisplay", width: content.clientWidth, height: content.clientHeight, density: density });
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
    if (location.protocol != "file:")
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

    let oldInnerWidth = content.clientWidth;
    let oldInnerHeight = content.clientHeight;
    setInterval(() => {
      if (content.clientWidth != oldInnerWidth || content.clientHeight != oldInnerHeight) {
        this.sendCommand({ req: "resizeDisplay", displayId: this.displayId, width: content.clientWidth, height: content.clientHeight, density });
        oldInnerHeight = content.clientHeight;
        oldInnerWidth = content.clientWidth;
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

    let desktop;
    if (store.x11usesproot) {
      desktop = this.termuxCmd(store.prootcmd.replace("%distro", store.distro).replace("%cmd", `SHELL=${store.defaultshellproot} ${store.startx11cmd}`));
    } else {
      desktop = this.termuxCmd(store.startx11cmd);
    }
    desktop.then(() => {
      console.error("x11 exited!");
      state.x11started = false;
      state.showx11 = false;
    });
  }

  async startCodeServer() {
    let desktop;
    if (store.codeserverusesproot) {
      desktop = this.termuxCmd(store.prootcmd.replace("%distro", store.distro).replace("%cmd", `SHELL=${store.defaultshellproot} ${store.codeservercmd.replace("%port", store.codeserverport.toString())}`));
    } else {
      desktop = this.termuxCmd(`SHELL=${store.defaultshelltermux} ${store.codeservercmd.replace("%port", store.codeserverport.toString())}`);
    }
    desktop.then(() => {
      console.error("codeserver exited!");
      state.codeserverstarted = false;
      state.x11started = state.x11started;
    });
  }

  async termuxCmd(cmd: string): Promise<number> {
    let e = await this.adb.subprocess.spawn(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; ${cmd}'`]);
    logProcess(e);
    return await e.exit;
  }
  async termuxShell(cmd: string): Promise<AdbSubprocessProtocol> {
    return await this.adb.subprocess.shell(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; ${cmd}'`]);
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
    switch (json.req) {
      case "apps":
        store.apps = json.packageInfos;
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
    let e = await this.adb.subprocess.shell(["sh", "-c", `true && CLASSPATH=${tmpdir}/server.apk app_process /system/bin org.mercuryworkshop.ziptie.Server`]);
    let resolvelaunched: ((_: unknown) => void) | undefined;
    e.stdout.pipeTo(new WritableStream({
      write(packet) {
        let msg = new TextDecoder().decode(packet)
        console.log(msg);
        if (msg.includes("[START]")) {
          resolvelaunched!(undefined);
        }
      }
    }) as any);
    e.stderr.pipeTo(new WritableStream({
      write(packet) {
        console.error(new TextDecoder().decode(packet));
      }
    }) as any);
    await new Promise(resolve => resolvelaunched = resolve);
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
    setInterval(() => this.sendCommand({ req: "openapps" }), 2000);
    debug.sendCommand = this.sendCommand.bind(this);
  }

  static async connect(device?: AdbDaemonDevice) {
    if (!device) {
      Manager.trackDevices();
      let devices = await Manager.getDevices();
      let selectedDevice: AdbDaemonWebUsbDevice | undefined;
      if (devices.length == 1) {
        selectedDevice = devices[0];
      } else {
        selectedDevice = await Manager.requestDevice();
        if (!selectedDevice) {
          throw new Error("No device selected");
        }
      }
      device = selectedDevice;
    }

    let connection = await device.connect();
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
    let mgr = new AdbManager(adb, fs);
    debug.mgr = mgr;
    return mgr;
  }
}
