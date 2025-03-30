import "dreamland";
import { AdbSubprocessProtocol } from '@yume-chan/adb';
import { Button, Card, Icon } from 'm3-dreamland';
import { mgr } from './main';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import "@xterm/xterm/css/xterm.css";

import iconTerminal from "@ktibow/iconset-material-symbols/terminal";
import iconAdd from "@ktibow/iconset-material-symbols/add";
import iconClose from "@ktibow/iconset-material-symbols/close";

type Tab = {
	id: number,
	process: AdbSubprocessProtocol,
	title: string,
	component: ComponentElement<typeof TerminalTab>,
};

const TerminalTab: Component<{
	process: AdbSubprocessProtocol,
}, {
	term: HTMLElement,
}> = function() {
	this.css = `
		width: 100%;
		height: 100%;
		background-color: #000;
		#terminal {
			width: 100%;
			height: 100%;
		}
	`;

	this.mount = async () => {
		const term = new XtermTerminal();
		const fit = new FitAddon();
		const clip = new ClipboardAddon();
		const links = new WebLinksAddon();
		term.loadAddon(fit);
		term.loadAddon(clip);
		term.loadAddon(links);

		term.open(this.term);
		fit.fit();
		setInterval(() => fit.fit(), 1000);

		this.process.stdout.pipeTo(new WritableStream({
			write(chunk) {
				term.write(chunk)
			}
		}) as any);
		this.process.stderr.pipeTo(new WritableStream({
			write(chunk) {
				term.write(chunk)
			}
		}) as any);
		let writer = this.process.stdin.getWriter();
		term.onData(data => {
			writer.write(new TextEncoder().encode(data));
		});
	};

	return <div>
		<div bind:this={use(this.term)} id="terminal"></div>
	</div>
};

export const Terminal: Component<{}, {
	processes: Tab[],
	activeTab: number,
	start: (shell: string) => Promise<void>,
	showMenu: boolean,
}> = function() {
	this.processes = [];
	this.activeTab = 0;
	this.showMenu = false;

	this.css = `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 0.5em;
		padding: 0.5em;

		.tabs {
			display: flex;
			gap: 0.5em;
			align-items: center;
			padding: 0.5em;
			border-bottom: 1px solid var(--md-sys-color-outline-variant);
		}

		.tab {
			display: flex;
			align-items: center;
			gap: 0.5em;
			padding: 0.5em;
			border-radius: 0.5em;
			cursor: pointer;
			transition: transform 0.2s ease-in-out;
			&:hover {
				transform: scale(1.05);
			}
		}

		.tab.active {
			background-color: var(--md-sys-color-surface-variant);
		}

		.terminal {
			flex: 1;
			overflow: hidden;
		}

		.terminal > div {
			height: 100%;
			display: none;
		}

		.terminal > div.active {
			display: block;
		}

		.add-menu {
			position: relative;
		}

		.menu {
			position: absolute;
			top: 100%;
			right: 0;
			background: var(--md-sys-color-surface);
			border: 1px solid var(--md-sys-color-outline-variant);
			border-radius: 0.5em;
			padding: 0.5em;
			z-index: 1000;
			min-width: 150px;
		}

		.menu-item {
			padding: 0.5em;
			cursor: pointer;
			border-radius: 0.25em;
			transition: background-color 0.2s;
			&:hover {
				background-color: var(--md-sys-color-surface-variant);
			}
		}

		.close-button {
			background: none;
			border: none;
			padding: 0;
		}
	`;

	this.start = async (shell: string) => {
		let process: AdbSubprocessProtocol;
		switch (shell) {
			case "sh":
				process = await mgr.adb.subprocess.shell("sh");
				break;
			case "termux":
				process = await mgr.termuxShell("TERM=xterm-256color bash");
				break;
			case "debian":
				process = await mgr.termuxShell("TERM=xterm-256color proot-distro login debian");
				break;
			default:
				throw new Error("Unknown shell type");
		}
		const component = <TerminalTab process={process} />;
		this.processes.push({
			id: Date.now(),
			process,
			title: `Terminal ${this.processes.length + 1} (${shell})`,
			component,
		});
		this.processes = this.processes;
		this.activeTab = this.processes.length - 1;
		this.showMenu = false;
	};

	return (
		<div>
			<div class="tabs">
				{use(this.processes, (tabs) => tabs.map((tab, index) => (
					<div
						class="tab"
						class:active={use(this.activeTab, x => x === index)}
						on:click={() => this.activeTab = index}
					>
						<Icon icon={iconTerminal} />
						{tab.title}
						<button
							class="close-button"
							on:click={(e: MouseEvent) => {
								e.stopPropagation();
								tab.process.kill();
								this.processes = this.processes.filter(t => t.id !== tab.id);
								if (this.activeTab >= this.processes.length) {
									this.activeTab = Math.max(0, this.processes.length - 1);
								}
							}}
						>
							<Icon
								icon={iconClose}
							/>
						</button>
					</div>
				)))}
				<div class="add-menu">
					<Button
						type="tonal"
						on:click={() => this.showMenu = !this.showMenu}
					>
						<Icon icon={iconAdd} />
					</Button>
					{use(this.showMenu, (show) => show && (
						<div class="menu">
              <Card type="elevated">
                <div class="menu-item" on:click={() => this.start("sh")}>Shell</div>
                <div class="menu-item" on:click={() => this.start("termux")}>Termux</div>
								<div class="menu-item" on:click={() => this.start("debian")}>Debian</div>
							</Card>
						</div>
					) || "")}
				</div>
			</div>
			<div class="terminal">
				{use(this.processes, (tabs) => tabs.map((tab, index) => (
					<div class:active={use(this.activeTab, x => x === index)}>
						{tab.component}
					</div>
				)))}
			</div>
		</div>
	);
};
