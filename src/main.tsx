import "dreamland";

import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbManager, gDisplayId, logProcess, prootCmd, startScrcpy, termuxCmd, termuxShell } from './adb';
import './style.css'
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { Scrcpy } from './scrcpy';
import { AdbSocket } from '@yume-chan/adb';
import { Terminal } from './Terminal';
import { proxyInitLibcurl, proxyLoadPage } from './proxy';

import type { IconifyIcon } from "@iconify/types";
import { Button, Card, CardClickable, Dialog, FAB, Icon, NavList, NavListButton, StyleFromParams, Switch, TextField } from 'm3-dreamland';

import iconPhonelinkSetup from "@ktibow/iconset-material-symbols/phonelink-setup";
import iconPhonelinkSetupOutline from "@ktibow/iconset-material-symbols/phonelink-setup-outline";
import iconCodeBlocks from "@ktibow/iconset-material-symbols/code-blocks";
import iconCodeBlocksOutline from "@ktibow/iconset-material-symbols/code-blocks-outline";
import iconMonitor from "@ktibow/iconset-material-symbols/monitor";
import iconMonitorOutline from "@ktibow/iconset-material-symbols/monitor-outline";
import iconTerminal from "@ktibow/iconset-material-symbols/terminal";
import iconSmartphone from "@ktibow/iconset-material-symbols/smartphone";
import iconSmartphoneOutline from "@ktibow/iconset-material-symbols/smartphone-outline";

import iconApps from "@ktibow/iconset-material-symbols/apps";

export const debug: any = {};
(window as any).dbg = debug;
export let mgr: AdbManager;
export const state = $state({
	connected: false,
	openApps: [] as { packageName: string, id: number, persistentId: number }[],
	showLauncher: false,
	showx11: false,

	content: null! as HTMLElement,

	scrcpy: null! as ComponentElement<typeof Scrcpy>,
	terminal: <Terminal />,
});
export const store = $store({
	apps: [] as NativeApp[],
}, {
	ident: "ziptie",
	backing: "localstorage",
	autosave: "auto"
});

async function connect(opts: SetupOpts) {
	try {
		mgr = await AdbManager.connect();
	} catch (error) {
		alert(error);
		throw error;
	}

	await mgr.startLogcat();
	await mgr.startNative();

	await mgr.startScrcpy(state.content);

	state.connected = true;
	state.scrcpy = <Scrcpy client={mgr.scrcpy!} />;
	state.terminal.$.start();
	state.scrcpy.$.showx11 = false;

	if (opts.disablecharge) {
		let setcharge = await mgr.adb.subprocess.spawnAndWait("dumpsys battery unplug");
		if (setcharge.exitCode != 0) {
			console.error("failed to disable charging");
		}
	} else {
		let setcharge = await mgr.adb.subprocess.spawnAndWait("dumpsys battery reset");
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
	apkPath: string,
	apkSize: number,
	enabled: boolean,
	firstInstallTime: number,
	lastUpdateTime: number,
	icon: string,
	label: string,
	packageName: string,
	versionName: string,
	signatures: string[],
	system: boolean,
	targetSdkVersion: number,
};

const NativeAppView: Component<{ app: NativeApp, }> = function() {
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
	)
}

const Launcher: Component<{
	launch: (app: string) => void,
}, {
	searchText: string,
	filteredApps: NativeApp[],
}> = function() {
	this.searchText = "";

	useChange([store.apps, this.searchText], () => {
		this.filteredApps = store.apps
			.filter(app => app.packageName.toLowerCase().includes(this.searchText.toLowerCase()))
	});

	this.css = `
		display: flex;
		flex-direction: column;
		gap: 1em;

		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
			gap: 1em;
		}

		.CardClickable-m3-container {
			width: 100%;
			height: 100%;
			justify-content: center;
		}
	`;

	let textfield = <TextField
		name="App name"
		bind:value={use(this.searchText)}
		display="block"
	/>
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
			<div class="grid">
				{use(this.filteredApps, x => x.map(x => (
					<CardClickable type="filled" on:click={() => {
						this.launch(x.packageName);
						this.searchText = "";
					}}>
						<NativeAppView app={x} />
					</CardClickable>
				)))}
			</div>
		</div>
	)
}

type SetupOpts = {
	disableanim: boolean,
	disablecharge: boolean,
};

const SetupToggle: Component<{ val: boolean, title: string }> = function() {
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
	)
}

const Setup: Component<{
	"on:connect": (opts: SetupOpts) => void,
}, {
	disableanim: boolean,
	disablecharge: boolean,
}> = function() {
	this.css = `
		display: flex;
		flex-direction: column;
		gap: 1em;

		padding: 1em;

		.settings {
			display: flex;
			flex-direction: column;
			gap: 1em;
		}
	`;

	this.disableanim = false;
	this.disablecharge = false;

	const connect = () => {
		const opts = {
			disableanim: this.disableanim,
			disablecharge: this.disablecharge,
		};

		this["on:connect"](opts);
	}

	return (
		<div>
			<div class="m3-font-headline-medium">Ziptie</div>
			ziptie your android to your chromebook

			<Card type="elevated">
				<div class="settings">
					<div class="m3-font-title-large">Settings</div>
					<SetupToggle bind:val={use(this.disablecharge)} title="Disable charging" />
					<SetupToggle bind:val={use(this.disableanim)} title="Disable animations" />
				</div>
			</Card>

			<Button type="filled" iconType="left" on:click={connect}>
				<Icon icon={iconPhonelinkSetup} />Connect
			</Button>
		</div>
	)
}

const Settings: Component<{}, {

}> = function() {
	this.css = `
		padding: 1em;
	`;

	return (
		<div>
			<div class="m3-font-headline-medium">Settings</div>
			<Button type="tonal" on:click={() => mgr.startX11()}>startx</Button>
			<Button type="tonal" on:click={() => {
				if (document.fullscreenElement) {
					document.exitFullscreen();
				} else {
					this.root.requestFullscreen();
				}
			}}>fullscreen</Button>
		</div>
	)
}

type Tabs = "scrcpy" | "terminal" | "code" | "settings";
type TabRoute = {
	cond: (tabs: Tabs) => boolean,
	click: () => void,
	label: string,
	icon: IconifyIcon,
	sicon: IconifyIcon,
};

const Nav: Component<{ shown: Tabs }, {}> = function() {
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

		div > div {
			height: 100%;
		}
	`;

	const routes: TabRoute[] = [
		{
			label: "Screen",
			icon: iconSmartphoneOutline,
			sicon: iconSmartphone,
			cond: x => x === "scrcpy" && !state.showx11,
			click: () => {
				state.showx11 = false;
				this.shown = "scrcpy";
			}
		},
		{
			label: "X11",
			icon: iconMonitorOutline,
			sicon: iconMonitor,
			cond: x => x === "scrcpy" && state.showx11,
			click: () => {
				mgr.openApp("com.termux.x11");
				state.showx11 = true;
				this.shown = "scrcpy";
			}
		},
		{
			label: "VSCode",
			icon: iconCodeBlocksOutline,
			sicon: iconCodeBlocks,
			cond: x => x === "code",
			click: async () => {
				console.log("loading page");
				await proxyInitLibcurl();
				this.shown = "code";
			}
		},
		{
			label: "Terminal",
			icon: iconTerminal,
			sicon: iconTerminal,
			cond: x => x === "terminal",
			click: () => this.shown = "terminal",
		},
		{
			label: "Settings",
			icon: iconPhonelinkSetupOutline,
			sicon: iconPhonelinkSetup,
			cond: x => x === "settings",
			click: () => this.shown = "settings"
		}
	];

	return (
		<div>
			<div class="items">
				{routes.map(x => (
					<NavListButton
						type="rail"
						icon={use(this.shown, y => x.cond(y) ? x.sicon : x.icon)}
						selected={use(this.shown, y => x.cond(y))}
						on:click={x.click}
					>
						{x.label}
					</NavListButton>
				))}
			</div>
			<div class="appdrawer">
				{use(state.openApps, x => x.slice(0, 9).map(x => (
					<button on:click={() => {
						state.showx11 = false;
						state.showLauncher = false;
						this.shown = "scrcpy";
						mgr.openApp(x.packageName);
					}}>
						<img src={store.apps.find(y => y.packageName === x.packageName)?.icon} />
					</button>
				)))}

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
	)
}

const Main: Component<{}, {
	shown: Tabs,
	codeframe: HTMLIFrameElement,
	content: HTMLElement,
}> = function() {
	this.css = `
		display: flex;
		.content {
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

	`;

	let launcher = <Launcher launch={(name: string) => {
		this.shown = "scrcpy";
		mgr.openApp(name);
		state.showx11 = false;
		state.showLauncher = false;
	}} />
	this.shown = "settings";

	this.mount = () => {
		state.content = this.content;
	}

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			state.showLauncher = false;
			e.preventDefault();
		}
		if (e.key === "Backspace") {
			if (e.target === document.activeElement) {
				// prevent closing the tab accidentally
				e.preventDefault();
			}
		}
		if (e.key === "Meta" && !state.showx11) {
			state.showLauncher = true;
			e.preventDefault();
			e.stopPropagation();
		}
	}, {
		capture: true,
	});

	let loadedFrame = false;
	useChange(this.shown, (x: Tabs) => {
		if (x === "code" && !loadedFrame) {
			proxyLoadPage(this.codeframe, "http://localhost:8080", "http://localhost:8080");
			loadedFrame = true;
		}
	});

	return (
		<div>
			<Dialog
				headline="Apps"
				bind:open={use(state.showLauncher)}
				closeOnClick={true}
			>
				{launcher}
				<div class="apps-actions">
					<Button type="tonal" on:click={() => state.showLauncher = false}>Close</Button>
				</div>
			</Dialog>

			<Nav bind:shown={use(this.shown)} />
			<div class="content" bind:this={use(this.content)}>
				<iframe id="codeframe" bind:this={use(this.codeframe)} class:visible={use(this.shown, x => x === "code")}/>
				{use(this.shown, (x: Tabs) => {
					if (x !== "scrcpy" && state.scrcpy) {
						state.showx11 = false;
					}

					if (x === "scrcpy") {
						return state.scrcpy;
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
	)
}

const App: Component<{}, {
	shown: HTMLElement,
}> = function() {
	this.shown = <Setup on:connect={async (opts) => {
		this.shown = <Main />;
		await connect(opts);
	}} />
	//this.shown = <Main />;

	return (
		<div id="app">
			<StyleFromParams scheme="vibrant" contrast={0} color="CBA6F7" />
			{use(this.shown)}
		</div>
	)
}

const root = document.getElementById("app")!;
try {
	root.replaceWith(<App />);
} catch (err) {
	console.log(err);
	root.replaceWith(document.createTextNode(`Failed to load: ${err}`));
}
