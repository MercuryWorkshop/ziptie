import { Terminal as XtermTerminal } from '@xterm/xterm';
import { adb } from './adb';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';

import "@xterm/xterm/css/xterm.css";

export const Terminal: Component<{}, {
  term: HTMLElement,
}, {
  start: () => Promise<void>
}> = function() {
  this.css = `
  width: 100%;
  height: 100%;
  #terminal {
    width: 100%;
    height: 100%;
  }
  `

  this.start = async () => {
    const term = new XtermTerminal();

    const fit = new FitAddon();
    const clip = new ClipboardAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(clip);
    term.loadAddon(links);

    term.open(this.term);
    fit.fit();

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
  };

  return <div>
    <div bind:this={use(this.term)} id="terminal"></div>
  </div>
}
