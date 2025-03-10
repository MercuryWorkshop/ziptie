import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { connectAdb, displayId, startScrcpy, termuxShell } from './adb';
import './style.css'
import "dreamland";
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';

// let prefix = "/data/user/0/com.termux/linuxdeploy-cli";
// let chrootdir = prefix + "/img";
let chrootdir = "/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/archlinux";
async function startx() {

  let write = await termuxShell();
  await write(`pkill -f x11\n`);
  await write(`export TMPDIR=${chrootdir}/tmp\n`);
  await write("termux-x11 :0\n");
  write = await termuxShell();
  await write("pulseaudio --start --exit-idle-time=-1\n");
  await write(`pacmd load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1\n`);

};
window.termuxshell = termuxShell;


let rootless = false;
async function chrootshell() {
  let write = await termuxShell();
  // await write(`cd ${prefix}\n`);
  // if (rootless) {
  //   await write(`export METHOD=proot\n`);
  // } else {
  //   await write(`export METHOD=chroot\n`);
  // }
  // await write("export TERM=linux\n");
  // await write("export TERM=linux\n");
  // if (!rootless) {
  //   await write(`tsu\n`);
  //   await new Promise(resolve => setTimeout(resolve, 1000));
  // }
  // await write("./cli.sh -d shell\n");


  await write(`proot-distro login archlinux\n`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await write(`export PULSE_SERVER=127.0.0.1\n`);
  await write(`export DISPLAY=:0\n`);

  return write;
}
async function lxde() {
  let write = await chrootshell();
  await write("startlxde\n");
}

const Scrcpy: Component<{}, {
  expanded: boolean,
}> = function() {
  this.css = `
height: 100%;
width: 100%;
background-color: red;
overflow: hidden;
display: flex;
position: relative;

> video {
  /* height: 100%; */
}
#sidebar {
  height: 6em;
  width: 1em;
  background-color: white;
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  border: 2px solid black;
  border-radius: 1em;
}
`
  return (
    <div>
      <div id="sidebar" on:click={() => {
        state.showscreen = false;
      }} />
    </div>
  )
}

const state = $state({
  connected: false,
  showscreen: false,
});


const App: Component<{}, {
  scrcpy: DLElement<typeof Scrcpy>,
  client: AdbScrcpyClient,
}> = function() {
  this.css = `

  .container {
    position: absolute;
    width: 100%;
    height: 100%;
    display: none;
  }
  .visible {
    display: block;
  }
  .center {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    width: 100%;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1em;
    background-color: white;
    border-radius: 1em;
    padding: 1em;
  }
  `
  const openApp = async (app: string) => {
    this.client.controller!.startApp(app);
    state.showscreen = true;
  }

  const connect = async () => {
    // while (true) {
    try {
      await connectAdb();
      // break;
    } catch (error) {
      alert(error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return;
    }
    // }

    this.client = await startScrcpy(this.scrcpy);

    let write = await termuxShell("sh");
    setTimeout(() => {
      write(`wm density 250 -d ${displayId}\n`);
    }, 1000);
    window.addEventListener("resize", async () => {
      // await write(`wm size ${window.innerWidth}x${window.innerHeight} -d ${displayId}\n`);
    });
    state.connected = true;
  }

  this.scrcpy = <Scrcpy />;
  return <div id="app">
    <div class="container" class:visible={use(state.showscreen)}>
      {this.scrcpy}
    </div>
    <div class="center">
      <div class="controls">
        {$if(use(state.connected),
          <div>
            <button on:click={startx}>startx</button>
            <button on:click={lxde}>lxde</button>
            <button on:click={() => openApp("com.termux.x11")}>termux</button>
            <button on:click={async () => {
              await this.client.controller!.injectKeyCode({
                action: AndroidKeyEventAction.Down,
                keyCode: AndroidKeyCode.AndroidHome,
              });
              await this.client.controller!.injectKeyCode({
                action: AndroidKeyEventAction.Up,
                keyCode: AndroidKeyCode.AndroidHome,
              });
              state.showscreen = true;
            }}>menu</button>
          </div>,
          <button on:click={connect}>connect adb</button>
        )}
      </div>
    </div>
  </div>
}

const root = document.getElementById("app")!;
try {
  root.replaceWith(<App />);
} catch (err) {
  console.log(err);
  root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
