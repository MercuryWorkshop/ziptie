import { AdbSocket } from "@yume-chan/adb";
import { adb } from "./adb";

// @ts-expect-error libcurl has no typedefs
import { libcurl } from "../out/libcurl_full.mjs";

// libcurl supports a custom tcp transport
// the interface just has to resemble a websocket
// treat the binary frames like tcp, send them down the adb socket
class AdbSocketWS extends EventTarget {
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

    console.error("connecting to (tcp:" + port + ")");
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


export async function proxyInitLibcurl() {
  await libcurl.load_wasm();
  libcurl.transport = AdbSocketWS;
  libcurl.set_websocket("ws://dummy");
}

export async function proxyLoadPage(iframe: HTMLIFrameElement, server: string, url: string) {
  let h = await libcurl.fetch(url);
  let html = await h.text();
  let doc = new DOMParser().parseFromString(html, 'text/html');

  let scripts = doc.querySelectorAll('script');
  for (let script of scripts) {
    if (!script.src) continue;
    let src = new URL(script.getAttribute("src")!, url).pathname;
    if (src == "/") continue;
    console.log("fetching", server + src);
    let res = await libcurl.fetch(server + src);
    let text = await res.text();
    text = text.replaceAll("location.href", "newlocation.href");
    let blob = new Blob([text], { type: "application/javascript" });
    let data = URL.createObjectURL(blob);
    script.src = data;
  }
  let styles = doc.querySelectorAll('link[rel="stylesheet"]') as NodeListOf<HTMLLinkElement>;
  for (let style of styles) {
    let src = new URL(style.getAttribute("href")!, url).pathname;
    if (src == "/") continue;
    let res = await libcurl.fetch(server + src);
    let text = await res.text();
    let urlregex = /url\(([^)]+)\)/g;

    while (true) {
      let match = urlregex.exec(text);
      if (!match) break;
      console.log(match);
      if (match[1].startsWith("data:")) continue;
      let _url = new URL(match[1], res.url);
      console.log(_url);
      let res2 = await libcurl.fetch(_url.toString());
      if (!res2.ok) console.error(res2);
      let blob = await res2.blob();
      let data = URL.createObjectURL(blob);
      text = text.replace(match[1], data);
    }

    let blob = new Blob([text], { type: "text/css" });
    let data = URL.createObjectURL(blob);
    style.href = data;
  }

  let newhtml = doc.documentElement.innerHTML;

  let cw = iframe.contentWindow!.window;
  cw.WebSocket = new Proxy(WebSocket, {
    construct(_target, args) {
      let url = new URL(args[0]);

      let socket = new libcurl.WebSocket("ws://127.0.0.1:8080" + url.pathname + "?" + url.searchParams);
      socket.binaryType = "arraybuffer";
      let om;

      socket.__defineSetter__("onmessage", (t: any) => om = t);
      socket.__defineGetter__("onmessage", () => (e: any) => {
        let d = e.data;
        e.__defineGetter__("data", () => new Blob([d]));
      });

      return socket;
    }
  });

  cw.fetch = (...args) => {
    console.log("fetch", args);
    args[0] = new URL(args[0].toString());
    args[0].host = "localhost:8080";
    return libcurl.fetch(args[0].toString(), ...args.slice(1));
  };

  let nativeset = cw.HTMLScriptElement.prototype.setAttribute;
  cw.HTMLScriptElement.prototype.setAttribute = function(name, value) {
    if (name == "src") {
      let newurl = server + new URL(value).pathname + "?" + new URL(value).searchParams;
      let url = new URL(newurl);
      if (url.protocol == "http:" || url.protocol == "https:") {
        libcurl.fetch(newurl).then(async (res: Response) => {
          let text = await res.text();
          let blob = new Blob([text], { type: "application/javascript" });
          let data = URL.createObjectURL(blob);
          this.src = data;
        });
      }
    } else {
      nativeset.call(this, name, value);
    }
  }

  iframe.contentDocument!.open();
  iframe.contentDocument!.write(newhtml);
  iframe.contentDocument!.close();

  const newlocation = {
    get href() {
      return url;
    },
    set href(value) {
      console.log("NAVIGATING TO", value);
      proxyLoadPage(iframe, server, server + new URL(value).pathname + "?" + new URL(value).searchParams);
    }
  };

  (cw as any).newlocation = newlocation;
  (cw as any).document.newlocation = newlocation;
}
