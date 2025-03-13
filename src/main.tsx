import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { adb, connectAdb, displayId, prootCmd, startScrcpy, termuxCmd, termuxShell } from './adb';
import './style.css'
import "dreamland";
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { Scrcpy } from './scrcpy';
// import { libcurl } from "../out/libcurl_full.mjs";
import { Terminal } from '@xterm/xterm';
import { AdbSocket } from '@yume-chan/adb';
import * as sandstone from "../sandstone/dist/sandstone.mjs";



function mkstream(text: string): any {
  let encoder = new TextEncoder();
  let uint8array = new Uint8Array(encoder.encode(text));
  return new ReadableStream({
    start(controller) {
      controller.enqueue(uint8array);
      controller.close();
    }
  });
}

// let prefix = "/data/user/0/com.termux/linuxdeploy-cli";
// let chrootdir = prefix + "/img";
let chrootdir = "/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/archlinux";
let tmpdir = "/data/local/tmp";

import zipmouse from "../zipmouse.c?raw"
import zipstart from "../zipstart.sh?raw"

window.termuxshell = termuxShell;
window.termuxcmd = termuxCmd;


export const state = $state({
  connected: false,
  showscreen: false,
  terminal: false,
});


const App: Component<{}, {
  scrcpy: ReturnType<typeof Scrcpy>,
  client: AdbScrcpyClient,
  expanded: boolean
}> = function() {
  this.css = `

  .container {
    position: absolute;
    width: 100%;
    height: 100%;
  }
  #scrcpycontainer {
    display: none;
  }
  #scrcpycontainer.visible {
    display: block;
  }
  #terminal {
    display: none;
  }
  #terminal.visible {
    display: block;
  }
  .center {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    width: 100%;
    z-index: 2;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1em;
    background-color: white;
    border-radius: 1em;
    padding: 1em;
  }
#sidebar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: 0;
  z-index: 2;
  width: 0em;
  height: 80%;
  border-top-right-radius: 1em;
  border-bottom-right-radius: 1em;
  background-color: white;
}
#sidebar .contents {
  display: flex;
  flex-direction: column;
  gap: 1em;
  overflow: hidden;
}
#sidebar.expanded {
  width: 5em;
  display: flex;
  border: 2px solid black;
}
#handle {
  position: absolute;
  top: 50%;
  transform: translate(100%, -50%);
  right: 0;
  height: 6em;
  width: 1em;
  background-color: white;
  border: 2px solid black;

  border-top-right-radius: 1em;
  border-bottom-right-radius: 1em;

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

    const term = new Terminal();
    term.open(document.getElementById("terminal")!);

    let shell = await adb.subprocess.shell("sh");
    shell.stdout.pipeTo(new WritableStream({
      write(chunk) {
        term.write(chunk)
      }
    }) as any);
    shell.stderr.pipeTo(new WritableStream({
      write(chunk) {
        term.write(chunk)
      }
    }) as any);
    let writer = shell.stdin.getWriter();
    term.onData(data => {
      writer.write(new TextEncoder().encode(data));
    });

    this.client = await startScrcpy(this.scrcpy);

    state.connected = true;
    this.scrcpy = <Scrcpy client={this.client} />;
  }
  const startx = async () => {
    let fs = await adb.sync();

    await fs.write({
      filename: tmpdir + "/zipmouse.c",
      file: mkstream(zipmouse)
    })
    await fs.write({
      filename: tmpdir + "/zipstart.sh",
      file: mkstream(zipstart)
    });

    await termuxCmd(`rm pipe; mkfifo pipe; sleep 2`);
    termuxCmd(`bash ${tmpdir}/zipstart.sh`);
    await termuxCmd(`sleep 2; cat pipe`);
    console.log("exited?");


    this.scrcpy.$.connectdaemon();

    // GALLIUM_DRIVER=virpipe MESA_GL_VERSION_OVERRIDE=4.0
    prootCmd("PULSE_SERVER=127.0.0.1 DISPLAY=:0 startlxde");
  };


  return <div id="app">
    <div class="container">
      <div id="sidebar" class:expanded={use(this.expanded)}>
        <div id="handle" on:click={() => {
          this.expanded = !this.expanded;
        }} />

        <div class="contents">
          <button on:click={startx}>startx</button>
          <button on:click={() => {
            openApp("com.termux.x11")
            this.scrcpy.$.showx11 = true;
            state.terminal = false;
          }}>termux</button>
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
            state.terminal = false;
            this.scrcpy.$.showx11 = false;
          }}>menu</button>
          <button on:click={() => {
            this.scrcpy.$.showx11 = false;
            state.showscreen = false;
            state.terminal = true;
          }}>terminal</button>
        </div>
      </div>
      <div id="scrcpycontainer" class:visible={use(state.showscreen)}>
        {use(this.scrcpy)}
      </div>
      <div id="terminal" class:visible={use(state.terminal)}>

      </div>
    </div>
    <div class="center">
      <div class="controls">
        {$if(use(state.connected),
          <div>
            <button on:click={() => {
              state.showscreen = true;
              this.root.querySelector(".center")!.remove();
            }}>show screen</button>
          </div>,
          <button on:click={connect}>connect adb</button>
        )}
      </div>
    </div>
  </div>
}
sandstone.libcurl.transport = class extends EventTarget {
  binaryType = "arraybuffer";
  stream = null;
  event_listeners = {};
  connection = null;

  onopen = () => { };
  onerror = () => { };
  onmessage: any = () => { };
  onclose = () => { };

  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
  url: string;
  protocols: string[];
  readyState = 0;
  socket: AdbSocket = null!;
  writer: WritableStreamDefaultWriter<any> = null!;
  constructor(url: string, protocols: string[]) {
    super();

    this.url = url;
    this.protocols = protocols

    let [host, port] = new URL(url).pathname.substring(1).split(":");
    if (host != "localhost" && host != "127.0.0.1") {
      throw new Error("libcurl tried connecting to " + host);
    }

    console.log("connecting to (tcp:" + port + ")");
    adb.createSocket("tcp:" + port).then(socket => {
      this.socket = socket;
      this.writer = socket.writable.getWriter();
      this.socket.readable.pipeTo(new WritableStream({
        write: (chunk) => {
          let data = chunk;
          this.dispatchEvent(new MessageEvent("message", {
            data: data.buffer,
          }));
          this.onmessage({ data: data.buffer });
        }
      }) as any);
      socket.closed.then(() => {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
        this.onclose();
      });
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      this.onopen();
    });
  }

  send(data: ArrayBuffer) {
    // this.writer.write(new TextEncoder().encode(`GET / HTTP/1.1\nHost: localhost:8080\nUser-Agent: curl/8.11.1\nAccept: */*\n\n`));
    this.writer.write(new Uint8Array(data));
  }
  get bufferedAmount() {
    let total = 0;
    return total;
  }

  get extensions() {
    return "";
  }

  get protocol() {
    return "binary";
  }
}
sandstone.libcurl.set_websocket("ws://dummy");


let roott;
async function loadPage(server: string, url: string) {
  const main_frame = new sandstone.controller.ProxyFrame();
  document.getElementById("app")!.replaceWith(main_frame.iframe);
  main_frame.navigate_to(url);
}

window.ss = sandstone;
window.trylibcurl = async () => {

  let server = 'http://localhost:8080';
  loadPage(server, server);
};

const root = document.getElementById("app")!;
try {
  root.replaceWith(<App />);
} catch (err) {
  console.log(err);
  root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
