import { Terminal as XtermTerminal } from '@xterm/xterm';
import { adb } from './adb';

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
  .xterm-scroll-area {
    display:none;
  }
  `

  this.start = async () => {
    const term = new XtermTerminal();
    term.open(this.term);

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
