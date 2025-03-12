import { Adb, AdbDaemonTransport, AdbSubprocessNoneProtocol, AdbSubprocessProtocol, AdbSubprocessShellProtocol, AdbSubprocessWaitResult } from '@yume-chan/adb';

import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from '@yume-chan/adb-scrcpy';
import { ScrcpyOptions3_1, DefaultServerPath, AndroidKeyCode, AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyAudioCodec } from "@yume-chan/scrcpy";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { AndroidKeyEventAction, ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

import { CodecOptions } from '@yume-chan/scrcpy/esm/1_17/impl';




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

export async function connectAdb() {
  const device: AdbDaemonWebUsbDevice | undefined = await Manager.requestDevice();
  if (!device) {
    throw new Error("No device selected");
  }

  let connection = await connect(device);

  const CredentialStore: AdbWebCredentialStore = new AdbWebCredentialStore("skibidi");
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: CredentialStore
  });
  adb = new Adb(transport);
  window.adb = adb;
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
        // profile: 10,
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
  return client;
}

export async function termuxCmdWait(cmd: string): Promise<AdbSubprocessWaitResult> {
  return await adb.subprocess.spawnAndWait(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
}

function logProcess(process: AdbSubprocessProtocol) {
  process.stdout.pipeTo(new WritableStream({
    write(packet) {
      console.log(new TextDecoder().decode(packet));
    }
  }) as any);
  process.stderr.pipeTo(new WritableStream({
    write(packet) {
      console.error(new TextDecoder().decode(packet));
    }
  }) as any);
}

export async function prootCmd(cmd: string): Promise<number> {
  return await termuxCmd(`proot-distro login archlinux --shared-tmp -- ${cmd}`);
}
export async function termuxCmd(cmd: string): Promise<number> {
  let a = await adb.subprocess.spawn(["run-as", "com.termux", "files/usr/bin/bash", "-c", `'export PATH=/data/data/com.termux/files/usr/bin:$PATH; export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so; ${cmd}'`]);
  console.log(a);
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
