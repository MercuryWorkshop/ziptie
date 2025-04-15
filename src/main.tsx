import "dreamland";

import { AdbManager } from "./adb";
import "./style.css";
import { Scrcpy } from "./scrcpy";
import { Terminal } from "./Terminal";
import { proxyInitLibcurl, proxyLoadPage } from "./proxy";
import { AdbDaemonWebsocketDevice } from "./WebSocketDevice";

import type { IconifyIcon } from "@iconify/types";
import {
  Button,
  Card,
  CardClickable,
  Dialog,
  FAB,
  Icon,
  NavListButton,
  StyleFromParams,
  Switch,
  TextField,
} from "m3-dreamland";

import iconPhonelinkSetup from "@ktibow/iconset-material-symbols/phonelink-setup";
import iconPhonelinkSetupOutline from "@ktibow/iconset-material-symbols/phonelink-setup-outline";
import iconCodeBlocks from "@ktibow/iconset-material-symbols/code-blocks";
import iconCodeBlocksOutline from "@ktibow/iconset-material-symbols/code-blocks-outline";
import iconMonitor from "@ktibow/iconset-material-symbols/monitor";
import iconMonitorOutline from "@ktibow/iconset-material-symbols/monitor-outline";
import iconTerminal from "@ktibow/iconset-material-symbols/terminal";

import iconApps from "@ktibow/iconset-material-symbols/apps";

export const debug: any = {};
(window as any).dbg = debug;
export let mgr: AdbManager;
export const state = $state({
  connected: false,
  openApps: [] as { packageName: string; id: number; persistentId: number }[],
  showLauncher: false,
  showx11: false,
  activeApp: null as string | null,
  relativeMouse: false,

  content: null! as HTMLElement,

  scrcpy: null! as ComponentElement<typeof Scrcpy>,
  terminal: <Terminal />,
  x11started: false,
  showSetup: true,
  codeserverstarted: false,
});
debug.state = state;
export const store = $store(
  {
    websocketUrl: "",
    apps: [] as NativeApp[],
    disableanim: false,
    disablecharge: false,
    defaultshell: "sh",
    defaultshelltermux: "bash",
    defaultshellproot: "bash",
    density: "150",
    prootcmd: "proot-distro login %distro --shared-tmp -- %cmd",
    startx11cmd:
      "GALLIUM_DRIVER=virpipe MESA_GL_VERSION_OVERRIDE=4.0 PULSE_SERVER=127.0.0.1 DISPLAY=:0 startlxde",
    codeservercmd: "code-server --auth none --port %port",
    codeserverport: 8080,
    x11usesproot: true,
    codeserverusesproot: false,
    distro: "debian",
  },
  {
    ident: "ziptie",
    backing: "localstorage",
    autosave: "auto",
  },
);

async function connect(opts: SetupOpts) {
  try {
    if (opts.websocketUrl) {
      const device = new AdbDaemonWebsocketDevice(opts.websocketUrl);
      mgr = await AdbManager.connect(device);
    } else {
      mgr = await AdbManager.connect();
    }
  } catch (error) {
    throw error;
  }

  await mgr.startLogcat();
  await mgr.startNative();

  await mgr.startScrcpy(state.content, store.density);

  state.connected = true;
  state.scrcpy = <Scrcpy client={mgr.scrcpy!} />;
  state.terminal.$.start("sh");
  state.showx11 = false;

  if (opts.disablecharge) {
    let setcharge = await mgr.adb.subprocess.spawnAndWait(
      "dumpsys battery unplug",
    );
    if (setcharge.exitCode != 0) {
      console.error("failed to disable charging");
    }
  } else {
    let setcharge = await mgr.adb.subprocess.spawnAndWait(
      "dumpsys battery reset",
    );
    if (setcharge.exitCode != 0) {
      console.error("failed to reset charging");
    }
  }
  if (opts.disableanim) {
    await mgr.setSetting("global", "window_animation_scale", "0");
    await mgr.setSetting("global", "transition_animation_scale", "0");
    await mgr.setSetting("global", "animator_duration_scale", "0");
  }
}

type NativeApp = {
  apkPath: string;
  apkSize: number;
  enabled: boolean;
  firstInstallTime: number;
  lastUpdateTime: number;
  icon: string;
  label: string;
  packageName: string;
  versionName: string;
  signatures: string[];
  system: boolean;
  targetSdkVersion: number;
};

const NativeAppView: Component<{ app: NativeApp }> = function () {
  this.css = `
		display: flex;
		flex-direction: column;
		align-items: center;

		gap: 0.5em;

		img {
			width: 64px;
			height: 64px;
		}

		.info {
			text-align: center;
			overflow-wrap: anywhere;
		}
	`;

  return (
    <div>
      <img src={this.app.icon} />
      <div class="info">
        <div>{this.app.label}</div>
        <div class="m3-font-label-medium">{this.app.versionName}</div>
      </div>
    </div>
  );
};

const Launcher: Component<
  {
    launch: (app: string) => void;
  },
  {
    searchText: string;
    filteredApps: NativeApp[];
  }
> = function () {
  this.searchText = "";

  useChange([store.apps, this.searchText], () => {
    this.filteredApps = store.apps.filter((app) =>
      app.packageName.toLowerCase().includes(this.searchText.toLowerCase()),
    );
  });

  this.css = `
		display: flex;
		flex-direction: column;
		gap: 1em;

		.grid-wrapper {
			overflow-y: scroll;
			height: 50vh;
		}

		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
			gap: 1em;
		}

		.CardClickable-m3-container {
			width: 100%;
			height: 100%;
			align-items: center;
			justify-content: center;
		}
	`;

  let textfield = (
    <TextField
      name="App name"
      bind:value={use(this.searchText)}
      display="block"
    />
  );
  let input = textfield.querySelector("input")!;
  input.addEventListener("input", () => {
    this.searchText = input.value;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!this.filteredApps[0]) return;
    this.launch(this.filteredApps[0].packageName);
    this.searchText = "";
    e.preventDefault();
  });
  textfield.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.focus();
  });
  useChange(state.showLauncher, () => {
    if (state.showLauncher) {
      setTimeout(() => input.focus(), 100);
    }
  });

  return (
    <div>
      {textfield}
      <div class="grid-wrapper">
        <div class="grid">
          {use(this.filteredApps, (x) =>
            x.map((x) => (
              <CardClickable
                type="filled"
                on:click={() => {
                  this.launch(x.packageName);
                  this.searchText = "";
                }}
              >
                <NativeAppView app={x} />
              </CardClickable>
            )),
          )}
        </div>
      </div>
    </div>
  );
};

type SetupOpts = {
  disableanim: boolean;
  disablecharge: boolean;
  websocketUrl?: string;
};

const SetupToggle: Component<{ val: boolean; title: string }> = function () {
  this.css = `
		display: flex;
		gap: 0.5em;
		align-items: center;

		label {
			height: 2rem;
		}
	`;

  return (
    <div>
      <Switch bind:checked={use(this.val)} />
      {this.title}
    </div>
  );
};

const Setup: Component<
  {
    "on:connect": (opts: SetupOpts) => void;
  },
  {
    error: string;
    installPrompt: any;
  }
> = function () {
  this.css = `
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    .main {
  		display: flex;
  		flex-direction: column;
  		gap: 1em;

  		padding: 1em;
      min-width: 75vw;
      min-height: 75vh;
		}

		.settings {
			display: flex;
			flex-direction: column;
			gap: 1em;
		}

		.connection-options {
			display: flex;
			flex-direction: column;
			gap: 1em;
		}
	`;

  store.disableanim = false;
  store.disablecharge = false;
  this.installPrompt = null;

  const handleInstall = async () => {
    if (!this.installPrompt) return;
    this.installPrompt.prompt();
    const { outcome } = await this.installPrompt.userChoice;
    if (outcome === "accepted") {
      console.log("User accepted the install prompt");
    }
    this.installPrompt = null;
  };

  this.mount = () => {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.installPrompt = e;
    });
  };

  const connect = async () => {
    const opts = {
      disableanim: store.disableanim,
      disablecharge: store.disablecharge,
    };
    this.error = "";
    try {
      await this["on:connect"](opts);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Unknown error";
    }
  };

  const connectWireless = async () => {
    if (!store.websocketUrl) {
      this.error = "Please enter a WebSocket URL";
      return;
    }
    const opts = {
      disableanim: store.disableanim,
      disablecharge: store.disablecharge,
      websocketUrl: store.websocketUrl,
    };
    this.error = "";
    try {
      await this["on:connect"](opts);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Unknown error";
    }
  };

  return (
    <div>
      <Card type="elevated">
        <div class="main">
          <div class="m3-font-headline-medium">Ziptie</div>
          connect android to your chromebook
          <a href="https://github.com/MercuryWorkshop/ziptie">
            a mercury workshop project
          </a>
          <Card type="filled">
            <div class="settings">
              <div class="m3-font-title-large">Settings</div>
              <SetupToggle
                bind:val={use(store.disablecharge)}
                title="Disable charging"
              />
              <SetupToggle
                bind:val={use(store.disableanim)}
                title="Disable animations"
              />
            </div>
          </Card>
          <div class="connection-options">
            <div class="m3-font-title-large">Connection</div>
            <TextField
              name="WebSocket URL"
              bind:value={use(store.websocketUrl)}
              placeholder="ws://localhost:8080"
              display="block"
            />
            <div style="display: flex; gap: 1em;">
              <Button type="filled" iconType="left" on:click={connect}>
                <Icon icon={iconPhonelinkSetup} />
                Connect via USB
              </Button>
              <Button type="filled" iconType="left" on:click={connectWireless}>
                <Icon icon={iconPhonelinkSetup} />
                Connect Wirelessly
              </Button>
            </div>
          </div>
          {use(
            this.error,
            (x) => x && <div class="m3-font-body-medium">{x}</div>,
          )}
          {use(
            this.installPrompt,
            (x) =>
              x && (
                <Button type="filled" on:click={handleInstall}>
                  Install App
                </Button>
              ),
          )}
          <LogView></LogView>
        </div>
      </Card>
    </div>
  );
};

const Settings: Component<{}, {}> = function () {
  this.css = `
		padding: 1em;
		display: flex;
		flex-direction: column;
		gap: 1em;
	`;

  return (
    <div>
      <div class="m3-font-headline-medium">Settings</div>
      <SetupToggle
        bind:val={use(state.relativeMouse)}
        title="Relative mouse mode"
      />
      <Button
        type="tonal"
        on:click={async () => {
          if (!state.x11started) {
            await mgr.startX11();
            state.x11started = true;
          }
        }}
      >
        startx
      </Button>
      <Button
        type="tonal"
        on:click={async () => {
          if (!state.codeserverstarted) {
            await mgr.startCodeServer();
            state.codeserverstarted = true;
            // TODO: this is jank
            state.x11started = state.x11started;
          }
        }}
      >
        start code server
      </Button>

      <TextField bind:value={use(store.density)} name="Screen Density (DPI)" />
      <SetupToggle
        bind:val={use(store.x11usesproot)}
        title="Use proot for X11"
      />
      <TextField bind:value={use(store.startx11cmd)} name="X11 start command" />
      <SetupToggle
        bind:val={use(store.codeserverusesproot)}
        title="Use proot for Codeserver"
      />
      <TextField
        bind:value={use(store.codeservercmd)}
        name="Codeserver command"
      />

      <TextField bind:value={use(store.defaultshell)} name="Default shell" />
      <TextField
        bind:value={use(store.defaultshelltermux)}
        name="Default shell (Termux)"
      />
      <TextField
        bind:value={use(store.defaultshellproot)}
        name="Default shell (Proot)"
      />

      <TextField bind:value={use(store.distro)} name="Proot Distro" />
      <TextField bind:value={use(store.prootcmd)} name="Proot command" />

      <Button
        type="tonal"
        on:click={() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.body.requestFullscreen();
          }
        }}
      >
        fullscreen
      </Button>
    </div>
  );
};

type Tabs = "scrcpy" | "terminal" | "code" | "settings";
type TabRoute = {
  cond: (tabs: Tabs) => boolean;
  disabled: () => boolean;
  click: () => void;
  label: string;
  icon: IconifyIcon;
  sicon: IconifyIcon;
};

const Nav: Component<{ shown: Tabs }, {}> = function () {
  this.css = `
		position: sticky;
		top: 0;
		left: 0;

		align-self: flex-start;
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		min-height: 100vh;
		padding-top: 1rem;
		padding-left: 0.25rem;
		padding-right: 0.25rem;
		min-width: 4rem;
		gap: 1rem;
		overflow-y: scroll;
		overflow-x: none;
		scrollbar-width: none;
		height: 100%;
		user-select: none;

		.items {
			justify-self: top;
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
			justify-content: center;
		}

		.appdrawer {
			display: flex;
			justify-content: center;
			flex-direction: column;
			align-items: center;
			gap: 1rem;
			button {
				height: 48px;
				width: min-content;
				border-radius: 50%;
				border: none;
				background-color: transparent;
				padding: 0;
				aspect-ratio: 1/1;
				display: flex;
				align-items: center;
				justify-content: center;

				cursor: pointer;
				transition: transform 0.2s ease-in-out;
				&:hover {
					transform: scale(1.05);
				}
				img {
					object-fit: cover;
					width: 100%;
					height: 100%;
				}
			}
		}
		.active {
			transform: scale(1.05);
		}
		.active::after {
			content: "";
			position: absolute;
			width: 90%;
			height: 4px;
			bottom: -6px;
			left: 50%;
			transform: translateX(-50%);
			background-color: #fff;
			border-radius: 1em;
		}

		div > div {
			height: 100%;
		}

		button[disabled] {
			opacity: 0.5;
			cursor: not-allowed;
		}
	`;

  const routes: TabRoute[] = [
    // {
    // 	label: "Screen",
    // 	icon: iconSmartphoneOutline,
    // 	sicon: iconSmartphone,
    // 	cond: x => x === "scrcpy" && !state.showx11,
    // 	click: () => {
    // 		state.showx11 = false;
    // 		this.shown = "scrcpy";
    // 	}
    // },
    {
      label: "X11",
      icon: iconMonitorOutline,
      sicon: iconMonitor,
      cond: (x) => x === "scrcpy" && state.showx11,
      disabled: () => !state.x11started,
      click: () => {
        mgr.openApp("com.termux.x11");
        state.showx11 = true;
        this.shown = "scrcpy";
      },
    },
    {
      label: "VSCode",
      icon: iconCodeBlocksOutline,
      sicon: iconCodeBlocks,
      cond: (x) => x === "code",
      disabled: () => !state.codeserverstarted,
      click: async () => {
        console.log("loading page");
        await proxyInitLibcurl();
        this.shown = "code";
      },
    },
    {
      label: "Terminal",
      icon: iconTerminal,
      sicon: iconTerminal,
      cond: (x) => x === "terminal",
      disabled: () => false,
      click: () => (this.shown = "terminal"),
    },
    {
      label: "Settings",
      icon: iconPhonelinkSetupOutline,
      sicon: iconPhonelinkSetup,
      cond: (x) => x === "settings",
      disabled: () => false,
      click: () => (this.shown = "settings"),
    },
  ];

  return (
    <div>
      <div class="items">
        {routes.map((x) => (
          <NavListButton
            type="rail"
            icon={use(this.shown, (y) => (x.cond(y) ? x.sicon : x.icon))}
            selected={use(this.shown, (y) => x.cond(y))}
            extraOptions={{
              disabled: use(state.x11started, x.disabled),
            }}
            on:click={x.click}
          >
            {x.label}
          </NavListButton>
        ))}
      </div>
      <div class="appdrawer">
        {use(state.openApps, (x) =>
          x
            .filter((x) => x.packageName !== "com.termux.x11")
            .map((x) => (
              <button
                class:active={use(
                  this.shown,
                  (y) => y === "scrcpy" && state.activeApp === x.packageName,
                )}
                on:click={() => {
                  state.showx11 = false;
                  state.showLauncher = false;
                  this.shown = "scrcpy";
                  mgr.openApp(x.packageName);
                  state.activeApp = x.packageName;
                }}
              >
                <img
                  src={
                    store.apps.find((y) => y.packageName === x.packageName)
                      ?.icon
                  }
                />
              </button>
            )),
        )}

        <FAB
          size="small"
          icon={iconApps}
          color="primary"
          on:click={() => {
            state.showLauncher = true;
          }}
        />
      </div>
    </div>
  );
};

const Main: Component<
  {
    show: boolean;
  },
  {
    shown: Tabs;
    codeframe: HTMLIFrameElement;
    content: HTMLElement;
  }
> = function () {
  this.css = `
		display: flex;
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		visibility: hidden;
		overflow: hidden;
		opacity: 0;
		transition: visibility 0.2s ease-in-out, opacity 0.2s ease-in-out;
		&.visible {
			visibility: visible;
			opacity: 1;
		}
		.content {
			overflow: hidden;
			flex: 1;
			min-width: 0;
			position: relative;
		}

		dialog:has(.Dialog-m3-container) {
			width: 75vw;
			height: 75vh;
			max-width: unset;
		}

		.apps-actions {
			display: flex;
			align-items: flex-end;
			margin-bottom: 1em;
		}

		#codeframe {
			width: 100%;
			height: 100%;
			border: none;
			visibility: hidden;
			position: absolute;
			top: 0;
			left: 0;
			background-color: #000;
		}
		#codeframe.visible {
			visibility: visible;
		}

		#scrcpy-container {
			visibility: hidden;
			position: absolute;
			top: 0;
			left: 0;
		}
		#scrcpy-container.visible {
			visibility: visible;
		}
	`;

  let launcher = (
    <Launcher
      launch={(name: string) => {
        this.shown = "scrcpy";
        mgr.openApp(name);
        state.showx11 = false;
        state.showLauncher = false;
        state.activeApp = name;
      }}
    />
  );
  this.shown = "settings";

  this.mount = () => {
    state.content = this.content;
  };

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        state.showLauncher = false;
        e.preventDefault();
      }
      if (e.key === "Backspace") {
        if (
          e.target === document.activeElement &&
          !state.showx11 &&
          !state.showLauncher
        ) {
          // prevent closing the tab accidentally
          e.preventDefault();
        }
      }
      if (e.key === "Meta" && !state.showx11 && !state.showSetup) {
        state.showLauncher = !state.showLauncher;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    {
      capture: true,
    },
  );

  let loadedFrame = false;
  useChange(this.shown, (x: Tabs) => {
    if (x === "code" && !loadedFrame) {
      proxyLoadPage(
        this.codeframe,
        "http://localhost:8080",
        "http://localhost:8080",
      );
      loadedFrame = true;
    }
  });

  return (
    <div class:visible={use(this.show)}>
      <Dialog
        headline="Apps"
        bind:open={use(state.showLauncher)}
        closeOnClick={true}
      >
        {launcher}
        <div class="apps-actions">
          <Button type="tonal" on:click={() => (state.showLauncher = false)}>
            Close
          </Button>
        </div>
      </Dialog>

      <Nav bind:shown={use(this.shown)} />
      <div class="content" bind:this={use(this.content)}>
        <iframe
          id="codeframe"
          bind:this={use(this.codeframe)}
          class:visible={use(this.shown, (x) => x === "code")}
        />
        <div
          id="scrcpy-container"
          class:visible={use(this.shown, (x) => x === "scrcpy")}
        >
          {use(state.scrcpy)}
        </div>
        {use(this.shown, (x: Tabs) => {
          if (x !== "scrcpy" && state.scrcpy) {
            state.showx11 = false;
          }

          if (x === "scrcpy") {
            // ...
          } else if (x === "terminal") {
            return state.terminal;
          } else if (x === "code") {
            //...
          } else if (x === "settings") {
            return <Settings />;
          }
        })}
      </div>
    </div>
  );
};

export type Log = { color: string; log: string };
export const loglisteners: ((log: Log) => void)[] = [];

function proxyConsole(name: string, color: string) {
  // @ts-expect-error ts sucks
  const old = console[name].bind(console);
  // @ts-expect-error ts sucks
  console[name] = (...args) => {
    let str;
    try {
      str = args.join(" ");
    } catch {
      str = "<failed to render>";
    }
    old(...args);
    for (const logger of loglisteners) {
      logger({ color, log: str });
    }
  };
}
proxyConsole("error", "var(--error)");
proxyConsole("warn", "var(--warning)");
proxyConsole("log", "var(--fg)");
proxyConsole("info", "var(--info)");
proxyConsole("debug", "var(--fg4)");
export const LogView: Component<{ scrolling: boolean }> = function () {
  this.css = `
		min-height: 0;
		flex: 1;
		font-family: var(--font-mono);

		.log {
			word-break: break-all;
		}

		::-webkit-scrollbar {
			width: 10px;
		}
		::-webkit-scrollbar-track {
			background: var(--surface3);
		}
		::-webkit-scrollbar-thumb {
			background: var(--surface6);
		}
	`;

  const create = (color: string, log: string) => {
    const el = document.createElement("div");
    el.classList.add("log");
    el.innerText = log;
    el.style.color = color;
    return el;
  };

  this.mount = () => {
    const logroot = this.root as HTMLElement;
    const frag = document.createDocumentFragment();

    loglisteners.push((x) => frag.append(create(x.color, x.log)));
    setInterval(() => {
      if (frag.children.length > 0) {
        logroot.appendChild(frag);
        logroot.scrollTop = logroot.scrollHeight;
      }
    }, 100);
  };

  return <div style={this.scrolling ? "overflow: auto" : "overflow: hidden"} />;
};

const App: Component<{}, {}> = function () {
  state.showSetup = true;
  let main = <Main show={use(state.showSetup, (x) => !x)} />;
  let setup = (
    <Setup
      on:connect={async (opts) => {
        await connect(opts);
        state.showSetup = false;
      }}
    />
  );

  return (
    <div id="app">
      <StyleFromParams scheme="vibrant" contrast={0} color="CBA6F7" />
      {use(state.showSetup, (x) => (x ? setup : ""))}
      {main}
    </div>
  );
};

const root = document.getElementById("app")!;
try {
  root.replaceWith(<App />);
} catch (err) {
  console.log(err);
  root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
