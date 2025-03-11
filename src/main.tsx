import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { adb, connectAdb, displayId, startScrcpy, termuxShell } from './adb';
import './style.css'
import "dreamland";
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { Scrcpy } from './scrcpy';
import { libcurl } from "../out/libcurl_full.mjs";
import { Terminal } from '@xterm/xterm';
import { AdbSocket } from '@yume-chan/adb';

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

export const state = $state({
  connected: false,
  showscreen: false,
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

    this.client = await startScrcpy(this.scrcpy);

    state.connected = true;
    this.scrcpy = <Scrcpy client={this.client} />;
  }
  const daemon = async () => {
    let write = await chrootshell();
    await write("./a.out\n");
    await new Promise(resolve => setTimeout(resolve, 5000));
    this.scrcpy.$.connectdaemon();
  }

  return <div id="app">
    <div class="container">
      <div id="sidebar" class:expanded={use(this.expanded)}>
        <div id="handle" on:click={() => {
          this.expanded = !this.expanded;
        }} />

        <div class="contents">
          <button on:click={startx}>startx</button>
          <button on:click={lxde}>lxde</button>
          <button on:click={daemon}>start anuramouse</button>
          <button on:click={() => {
            openApp("com.termux.x11")
            this.scrcpy.$.showx11 = true;
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
            this.scrcpy.$.showx11 = false;
          }}>menu</button>
        </div>
      </div>
      <div id="scrcpycontainer" class:visible={use(state.showscreen)}>
        {use(this.scrcpy)}
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

window.libcurl = libcurl;
window.trylibcurl = async () => {
  await libcurl.load_wasm();
  libcurl.transport = class extends EventTarget {
    binaryType = "blob";
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
      console.log(url);

      this.url = url;
      this.protocols = protocols

      let [host, port] = new URL(url).pathname.substring(1).split(":");
      if (host != "localhost" && host != "127.0.0.1") {
        throw new Error("libcurl tried connecting to " + host);
      }

      adb.createSocket("tcp:" + port).then(socket => {
        this.socket = socket;
        this.writer = socket.writable.getWriter();
        this.socket.readable.pipeTo(new WritableStream({
          write: (chunk) => {
            let data = chunk;
            this.dispatchEvent(new MessageEvent("message", {
              data,
            }));
            this.onmessage({ data });
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
  console.log(libcurl);
  libcurl.set_websocket("ws://dummy");

  let server = 'http://localhost:8080';
  libcurl.fetch(server).then(h => h.text()).then(async html => {
    console.log(html);
    let doc = new DOMParser().parseFromString(html, 'text/html');

    let scripts = doc.querySelectorAll('script');
    for (let script of scripts) {
      if (!script.src) continue;
      let src = new URL(script.src).pathname;
      if (src == "/") continue;
      console.log(server + src);
      let res = await libcurl.fetch(server + src);
      let text = await res.blob();
      let data = URL.createObjectURL(text);
      script.src = data;
    }
    let styles = doc.querySelectorAll('link[rel="stylesheet"]') as NodeListOf<HTMLLinkElement>;
    for (let style of styles) {
      let src = new URL(style.href).pathname;
      if (src == "/") continue;
      console.log(server + src);
      let res = await libcurl.fetch(server + src);
      let text = await res.blob();
      let data = URL.createObjectURL(text);
      style.href = data;
    }

    let newhtml = doc.documentElement.innerHTML;
    let iframe = document.createElement('iframe');
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    document.getElementById("app")!.replaceWith(iframe);

    iframe.contentWindow!.window.WebSocket = new Proxy(WebSocket, {
      construct(target, args) {
        let url = new URL(args[0]);


        console.log("ws://127.0.0.1:8080" + url.pathname + "?" + url.searchParams);
        return new libcurl.WebSocket("ws://127.0.0.1:8080" + url.pathname + "?" + url.searchParams);
      }
    });

    iframe.contentWindow!.fetch = (...args) => {
      args[0] = new URL(args[0].toString());
      args[0].host = "localhost:8080";
      console.log(args);
      return libcurl.fetch(args[0].toString(), ...args.slice(1));
    };

    iframe.contentDocument!.open();
    iframe.contentDocument!.write(newhtml);
    iframe.contentDocument!.close();
  });

};

const root = document.getElementById("app")!;
try {
  root.replaceWith(<App />);
} catch (err) {
  console.log(err);
  root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
