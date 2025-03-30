import { AdbScrcpyClient } from "@yume-chan/adb-scrcpy";
import { VideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
import { Float32PcmPlayer } from '@yume-chan/pcm-player'
import {
	InsertableStreamVideoFrameRenderer,
	WebGLVideoFrameRenderer,
	BitmapVideoFrameRenderer,
	WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import {
	AndroidKeyCode,
	AndroidKeyEventAction,
	AndroidKeyEventMeta,
	AndroidMotionEventAction,
	AndroidMotionEventButton,
	ScrcpyAudioCodec,
	ScrcpyControlMessageWriter
} from "@yume-chan/scrcpy";
import { OpusStream } from "./audio";
import { mgr, state } from "./main";

function createVideoFrameRenderer(): {
	renderer: VideoFrameRenderer;
	element: HTMLVideoElement | HTMLCanvasElement;
} {
	if (InsertableStreamVideoFrameRenderer.isSupported) {
		const renderer = new InsertableStreamVideoFrameRenderer();
		return { renderer, element: renderer.element };
	}

	if (WebGLVideoFrameRenderer.isSupported) {
		const renderer = new WebGLVideoFrameRenderer();
		return { renderer, element: renderer.canvas as HTMLCanvasElement };
	}

	const renderer = new BitmapVideoFrameRenderer();
	return { renderer, element: renderer.canvas as HTMLCanvasElement };
}

export const Scrcpy: Component<{
	client: AdbScrcpyClient,
}, {
	expanded: boolean,
}, {}> = function() {
	this.css = `
	height: 100%;
	width: 100%;
	background-color: red;
	overflow: hidden;
	display: flex;
	position: relative;

	> video {
	  /* height: 100%; */
	}
`

	let screenWidth = 0;
	let screenHeight = 0;

	const startAudio = async () => {
		let metadata = await this.client.audioStream!;
		if (metadata.type != "success") throw new Error("Audio stream failed");
		const [_recordStream, playbackStream] = metadata.stream.tee();
		let player: any;
		if (metadata.codec === ScrcpyAudioCodec.Raw) {
			console.info('audio codec raw')
		} else if (metadata.codec === ScrcpyAudioCodec.Opus) {
			console.info('audio codec opus')
			player = new Float32PcmPlayer(48000, 2)
			playbackStream
				.pipeThrough(
					new OpusStream({
						codec: metadata.codec.webCodecId,
						numberOfChannels: 2,
						sampleRate: 48000,
					}) as any
				)
				.pipeTo(
					new WritableStream({
						write: (chunk) => {
							player.feed(chunk)
						},
					}) as any
				)

			player.start();
		}
	}
	const startVideo = async () => {
		const { metadata: videoMetadata, stream: videoPacketStream } = await this.client.videoStream!;
		const renderer = createVideoFrameRenderer();
		this.root.appendChild(renderer.element);
		const decoder = new WebCodecsVideoDecoder({
			codec: videoMetadata.codec,
			renderer: renderer.renderer,
		});

		decoder.sizeChanged(({ width, height }) => {
			screenWidth = width;
			screenHeight = height;
		});

		videoPacketStream.pipeTo(decoder.writable).catch((error: string) => {
			console.error(error);
		});

		this.client.stdout.pipeTo(new WritableStream({
			write(packet: string) {
				console.log(packet);
			}
		}) as any);
		return renderer;
	}

	let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

	const startController = async (video: HTMLVideoElement, controller: ScrcpyControlMessageWriter) => {
		const injectKeyCode = (e: KeyboardEvent) => {
			const { type, code } = e

			if (state.showx11) {
				e.preventDefault()
				e.stopPropagation()

				let state = e.type == "keydown" ? 1 : 0;
				let keyCode = jsToX11Keycode[e.keyCode];
				if (keyCode == undefined) return;

				mgr.writeMouseCmd([0, keyCode, state, 0, 0]);
			} else {
				let action: AndroidKeyEventAction;
				switch (type) {
					case 'keydown':
						action = AndroidKeyEventAction.Down;
						break
					case 'keyup':
						action = AndroidKeyEventAction.Up;
						break
					default:
						throw new Error(`Unsupported event type: ${type}`)
				}

				const keyCode = AndroidKeyCode[code as keyof typeof AndroidKeyCode];
				let metaState = 0;
				if (e.ctrlKey) metaState |= AndroidKeyEventMeta.Ctrl;
				if (e.altKey) metaState |= AndroidKeyEventMeta.Alt;
				if (e.shiftKey) metaState |= AndroidKeyEventMeta.Shift;
				if (e.metaKey) metaState |= AndroidKeyEventMeta.Meta;

				controller.injectKeyCode({
					action,
					keyCode,
					repeat: 0,
					metaState,
				});
			}
		}

		const injectScroll = (e: WheelEvent) => {
			e.preventDefault()
			e.stopPropagation()

			if (state.showx11) {
				mgr.writeMouseCmd([2, e.deltaX, e.deltaY, 0, 0]);
			} else {
				controller.injectScroll({
					...getPointer(video, e.clientX, e.clientY),
					scrollX: -e.deltaX / 100,
					scrollY: -e.deltaY / 100,
					buttons: 0,
				})
			}
		};
		const injectTouch = async (e: PointerEvent) => {
			e.preventDefault()
			e.stopPropagation()


			const target = e.currentTarget as HTMLElement
			target.setPointerCapture(e.pointerId)

			const { type, clientX, clientY, button, buttons } = e

			const PointerEventButtonToAndroidButton = [
				AndroidMotionEventButton.Primary,
				AndroidMotionEventButton.Tertiary,
				AndroidMotionEventButton.Secondary,
				AndroidMotionEventButton.Back,
				AndroidMotionEventButton.Forward,
			]

			if (state.showx11) {
				let { pointerX, pointerY } = getPointer(video, clientX, clientY);

				let jsButtonToX = [
					1, 2, 3, 8, 9
				];
				switch (type) {
					case "pointermove":
						await mgr.writeMouseCmd([1, pointerX, pointerY, -1, 0]);
						break;
					case "pointerdown":
						await mgr.writeMouseCmd([1, pointerX, pointerY, jsButtonToX[e.button], 1]);
						break;
					case "pointerup":
						await mgr.writeMouseCmd([1, pointerX, pointerY, jsButtonToX[e.button], 0]);
						break;
				}
			} else {
				switch (type) {
					case 'pointerdown':
						await controller.injectTouch({
							action: AndroidMotionEventAction.Down,
							pointerId: BigInt(e.pointerId),
							...getPointer(video, clientX, clientY),
							actionButton: PointerEventButtonToAndroidButton[button],
							pressure: 1.0,
							buttons,
						});
						break
					case 'pointermove':
						await controller.injectTouch({
							action: e.buttons ? AndroidMotionEventAction.Move : AndroidMotionEventAction.HoverMove,
							pointerId: BigInt(e.pointerId),
							...getPointer(video, clientX, clientY),
							pressure: 1.0,
							buttons,
						});
						break
					case 'pointerup':
						await controller.injectTouch({
							action: AndroidMotionEventAction.Up,
							pointerId: BigInt(e.pointerId),
							...getPointer(video, clientX, clientY),
							pressure: 0,
							actionButton: PointerEventButtonToAndroidButton[button],
							buttons,
						});
						break;
					case 'contextmenu':
						await controller.injectTouch({
							action: AndroidMotionEventAction.Down,
							pointerId: BigInt(e.pointerId),
							...getPointer(video, clientX, clientY),
							actionButton: AndroidMotionEventButton.Secondary,
							pressure: 1.0,
							buttons,
						});
						await controller.injectTouch({
							action: AndroidMotionEventAction.Up,
							pointerId: BigInt(e.pointerId),
							...getPointer(video, clientX, clientY),
							pressure: 0,
							actionButton: AndroidMotionEventButton.Secondary,
							buttons,
						});
						break;
					default:
						throw new Error(`Unsupported event type: ${type}`)
				}
			}
		}

		document.body.addEventListener("keydown", injectKeyCode as any);
		document.body.addEventListener("keyup", injectKeyCode as any);
		video.addEventListener("wheel", injectScroll as any);
		video.addEventListener("pointerdown", injectTouch as any);
		video.addEventListener("pointermove", injectTouch as any);
		video.addEventListener("pointerup", injectTouch as any);
		video.addEventListener("contextmenu", injectTouch as any);
		video.setAttribute('tabindex', '0');
		video.focus();
	}


	this.mount = async () => {
		let renderer = await startVideo();
		await startAudio();
		await startController(renderer.element as HTMLVideoElement, this.client.controller!);
		// @ts-ignore
		window.renderer = renderer;




	}

	return (
		<div>
		</div>
	)
}
function getPointer(el: HTMLVideoElement, clientX: number, clientY: number) {
	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
	const screenWidth = el.width
	const screenHeight = el.height

	const rect = el.getBoundingClientRect()

	const videoRect = {
		width: 0,
		height: 0,
		x: 0,
		y: 0,
	}
	if (screenWidth / screenHeight < rect.width / rect.height) {
		videoRect.height = rect.height
		videoRect.width = videoRect.height * (screenWidth / screenHeight)
		videoRect.x = rect.x + (rect.width - videoRect.width) / 2
		videoRect.y = rect.y
	} else {
		videoRect.width = rect.width
		videoRect.height = videoRect.width * (screenHeight / screenWidth)
		videoRect.x = rect.x
		videoRect.y = rect.y + (rect.height - videoRect.height) / 2
	}

	const percentageX = clamp((clientX - videoRect.x) / videoRect.width, 0, 1)
	const percentageY = clamp((clientY - videoRect.y) / videoRect.height, 0, 1)

	const pointerX = percentageX * screenWidth
	const pointerY = percentageY * screenHeight

	return {
		screenWidth,
		screenHeight,
		pointerX,
		pointerY,
	}
}


const jsToX11Keycode: Record<number, number> = {
	65: 38, // A
	66: 56, // B
	67: 54, // C
	68: 40, // D
	69: 26, // E
	70: 41, // F
	71: 42, // G
	72: 43, // H
	73: 31, // I
	74: 44, // J
	75: 45, // K
	76: 46, // L
	77: 58, // M
	78: 57, // N
	79: 32, // O
	80: 33, // P
	81: 24, // Q
	82: 27, // R
	83: 39, // S
	84: 28, // T
	85: 30, // U
	86: 55, // V
	87: 25, // W
	88: 53, // X
	89: 29, // Y
	90: 52, // Z
	48: 19, // 0
	49: 10, // 1
	50: 11, // 2
	51: 12, // 3
	52: 13, // 4
	53: 14, // 5
	54: 15, // 6
	55: 16, // 7
	56: 17, // 8
	57: 18, // 9
	32: 65, // Space
	13: 36, // Enter
	8: 22,  // Backspace
	9: 23,  // Tab
	27: 9,  // Escape
	37: 113, // Left Arrow
	38: 111, // Up Arrow
	39: 114, // Right Arrow
	40: 116, // Down Arrow
	112: 67, // F1
	113: 68, // F2
	114: 69, // F3
	115: 70, // F4
	116: 71, // F5
	117: 72, // F6
	118: 73, // F7
	119: 74, // F8
	120: 75, // F9
	121: 76, // F10
	122: 95, // F11
	123: 96, // F12
	16: 50, // Shift (left)
	17: 37, // Control (left)
	18: 64, // Alt (left)
	91: 133, // Meta (Super/Windows key)
	187: 21, // =
	189: 20, // -
	192: 49, // `
	219: 34, // [
	221: 35, // ]
	220: 51, // \
	186: 47, // ;
	222: 48, // '
	188: 59, // ,
	190: 60, // .
	191: 61, // /
	45: 118, // Insert
};
