import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbManager, gDisplayId, logProcess, prootCmd, startScrcpy, termuxCmd, termuxShell } from './adb';
import './style.css'
import "dreamland";
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { Scrcpy } from './scrcpy';
import { AdbSocket } from '@yume-chan/adb';


export const debug: any = {};
(window as any).dbg = debug;


export let adb: AdbManager;




import { Terminal } from './Terminal';
import { proxyInitLibcurl, proxyLoadPage } from './proxy';
export const state = $state({
  connected: false,
});



const App: Component<{}, {
  scrcpy: ReturnType<typeof Scrcpy>,
  client: AdbScrcpyClient,
  expanded: boolean,
  shown: "scrcpy" | "terminal" | "code",
  codeframe: HTMLIFrameElement,
  disablecharge: boolean,
  noui: boolean,

}> = function() {
  this.css = `
overflow: hidden;
  .container {
    overflow: hidden;
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
  button {
    width: 100%;
    height: 6em;
  }
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1em;
    border-radius: 1em;
    border: 2px solid black;
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
iframe {
  width: 100%;
  height: 100%;
  border: none;
}
  `

  let terminal = <Terminal />;
  const openApp = async (app: string) => {
    this.client.controller!.startApp(app);
    this.shown = "scrcpy";
  }

  const connect = async () => {
    try {
      adb = await AdbManager.connect();
    } catch (error) {
      alert(error);
      return;
    }

    await adb.startNative();

    await adb.startScrcpy();

    state.connected = true;
    this.scrcpy = <Scrcpy client={adb.scrcpy!} />;
    terminal.$.start();

    this.shown = "scrcpy";

    // let setanims = await adb.subprocess.spawnAndWait("settings put global window_animation_scale 0 && settings put global transition_animation_scale 0 && settings put global animator_duration_scale 0");
    // if (setanims.exitCode != 0) {
    //   console.error("failed to disable animations");
    // }
    // if (this.disablecharge) {
    //   let setcharge = await adb.subprocess.spawnAndWait("dumpsys battery unplug");
    //   if (setcharge.exitCode != 0) {
    //     console.error("failed to disable charging");
    //   }
    // } else {
    //   let setcharge = await adb.subprocess.spawnAndWait("dumpsys battery reset");
    //   if (setcharge.exitCode != 0) {
    //     console.error("failed to reset charging");
    //   }
    // }
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


  // console.log(await adb.subprocess.spawnAndWait("am start-service -n org.mercuryworkshop.ziptieserver/.ServerService"));
  //
  // await new Promise(resolve => setTimeout(resolve, 5000));
  // let socket = await adb.createSocket("localabstract:ziptie");
  // let writer = socket.writable.getWriter();
  // let te = new TextEncoder();
  // let td = new TextDecoder();
  // writer.write(te.encode("hello\n"));
  // socket.readable.pipeTo(new WritableStream({
  //   write(packet) {
  //     console.log(td.decode(packet));
  //   }
  // }) as any);




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
            this.shown = "scrcpy";
          }}>termux</button>
          <button on:click={async () => {
            await adb.subprocess.spawnAndWait("am start -n com.google.android.apps.nexuslauncher/.NexusLauncherActivity --ez android.intent.extra.FULLSCREEN true");
            this.shown = "scrcpy";
            this.scrcpy.$.showx11 = false;
          }}>menu</button>
          <button on:click={async () => {
            await adb.subprocess.spawnAndWait("am start -n com.discord/.main.MainDefault --ez android.intent.extra.FULLSCREEN true");
            this.shown = "scrcpy";
            this.scrcpy.$.showx11 = false;
          }}>discord</button>
          <button on:click={() => {
            this.shown = "terminal";
            this.scrcpy.$.showx11 = false;
          }}>terminal</button>
          <button on:click={() => {
            this.shown = "code";
            this.scrcpy.$.showx11 = false;
          }}>code</button>
          <button on:click={async () => {
            // prootCmd("code-server --auth none");
            console.log("loading page");
            await proxyInitLibcurl();
            await proxyLoadPage(this.codeframe, "http://localhost:8080", "http://localhost:8080");
          }}>start codeserver</button>
        </div>
      </div>
      <div id="scrcpycontainer" class:visible={use(this.shown, s => s == "scrcpy")}>
        {use(this.scrcpy)}
      </div>
      {$if(use(this.shown, s => s == "terminal"),
        terminal
      )}
      <iframe bind:this={use(this.codeframe)} class:visible={use(this.shown, s => s == "code")} />
    </div>
    {$if(use(state.connected, s => !s),
      <div class="center">
        <div class="controls">
          <button on:click={connect}>connect adb</button>
          <label>disable charging</label>
          <input type="checkbox" bind:checked={use(this.disablecharge)} />
        </div>
      </div>
    )}
  </div>
}

const root = document.getElementById("app")!;
try {
  root.replaceWith(<App />);
} catch (err) {
  console.log(err);
  root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
