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
type NativeApp = any
export const state = $state({
  connected: false,
  apps: {} as Record<string, NativeApp>,
  openApps: [] as string[],
  showLauncher: false,
});


const Launcher: Component<{
  launch: (app: string) => void,
}> = function() {
  this.css = `
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 1em;
  background-color: black;
  overflow-y: auto;
  overflow-x: hidden;
  width: 100%;
  height: 100%;
  padding: 1em;

  button {
    aspect-ratio: 1;
    background-color: white;
    border: none;
    padding: 0.5em;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 0.5em;
    transition: transform 0.2s ease;

    &:hover {
      transform: scale(1.05);
    }

    img {
      width: 48px;
      height: 48px;
      margin-bottom: 0.5em;
    }

    span {
      font-size: 0.8em;
      text-align: center;
      word-break: break-word;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
      max-height: 2.4em;
    }
  }
  `

  return <div>
    {use(state.apps, apps => Object.values(apps).map(app =>
      <button on:click={() => this.launch(app.packageName)}>
        <img src={app.icon} />
        <span>{app.packageName}</span>
      </button>
    ))}
  </div>
}

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
    border-radius: 0.5em;
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

  .launcher {
    width: 60%;
    height: 60%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .launcher.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .launcher-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    z-index: 0;
  }

  .launcher-backdrop.visible {
    opacity: 1;
    pointer-events: auto;
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
    padding: 1em;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  #sidebar.expanded .contents {
    opacity: 1;
    pointer-events: auto;
  }
  #sidebar.expanded {
    width: 5em;
    display: flex;
    border: 2px solid black;
  }
  #sidebar .contents button {
    aspect-ratio: 1;
    height: auto;
    padding: 0.5em;
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

    await adb.startLogcat();
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





  return <div id="app">
    <div class="container">
      <div id="sidebar" class:expanded={use(this.expanded)} on:click={() => state.showLauncher = false}>
        <div id="handle" on:click={() => {
          this.expanded = !this.expanded;
        }} />

        <div class="contents">
          <button on:click={(e: MouseEvent) => {
            e.stopPropagation();
            state.showLauncher = true;
          }}>launcher</button>
          <button on:click={startx}>startx</button>
          <button on:click={() => {
            openApp("com.termux.x11")
            this.scrcpy.$.showx11 = true;
            this.shown = "scrcpy";
          }}>termux</button>
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
      <div class="launcher-backdrop" class:visible={use(state.showLauncher)} on:click={() => state.showLauncher = false} />
      <div class="launcher" class:visible={use(state.showLauncher)}>
        <Launcher launch={(name: string) => {
          this.shown = "scrcpy";
          adb.openApp(name);
          this.scrcpy.$.showx11 = false;
          state.showLauncher = false;
        }} />
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
