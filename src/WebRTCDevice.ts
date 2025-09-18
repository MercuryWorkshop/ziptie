import { AdbDaemonDevice, AdbPacket, AdbPacketSerializeStream, AdbPacketData, AdbPacketInit } from "@yume-chan/adb";
import { MaybeConsumable, pipeFrom, ReadableStream, StructDeserializeStream, WrapReadableStream, Consumable } from "@yume-chan/stream-extra";
import { database } from "./firebase";
import { ref, set, onValue, off, remove, push, get } from "firebase/database";

export class AdbDaemonWebRTCDevice implements AdbDaemonDevice {
  static isSupported(): boolean {
    return typeof RTCPeerConnection !== "undefined";
  }

  readonly serial: string;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingChannel: string;

  get name(): string | undefined {
    return this.signalingChannel;
  }

  constructor(signalingChannel: string) {
    this.serial = signalingChannel;
    this.signalingChannel = signalingChannel;
  }

  async connect() {
    console.log("WebRTC: Starting connection");
    // Create RTCPeerConnection
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.voip.blackberry.com:3478" },
      ]
    });

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(`WebRTC ICE connection state: ${this.peerConnection?.iceConnectionState}`);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log(`WebRTC connection state: ${this.peerConnection?.connectionState}`);
    };

    // Create data channel for ADB communication
    console.log("WebRTC: Creating data channel");
    this.dataChannel = this.peerConnection.createDataChannel("adb", { ordered: true });
    this.setupDataChannel();

    const dataChannelOpen = new Promise<void>(resolve => {
        this.dataChannel!.onopen = () => {
            console.log("WebRTC: Data channel opened");
            resolve();
        };
    });

    // Set up signaling
    const offerRef = ref(database, `${this.signalingChannel}/offer`);
    const answerRef = ref(database, `${this.signalingChannel}/answer`);
    console.log(answerRef);
    const candidatesRef = ref(database, `${this.signalingChannel}/candidates`);

    const remoteCandidates: RTCIceCandidateInit[] = [];
    let remoteDescriptionSet = false;

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("WebRTC: Found ICE candidate", event.candidate);
            console.log("WebRTC: Found ICE candidate, sending to signaling server");
            // Add local ICE candidate to Firebase
            set(push(candidatesRef), {
                type: "local",
                candidate: event.candidate.toJSON()
            });
        }
    };

    // Listen for remote ICE candidates
    console.log("WebRTC: Listening for remote ICE candidates");
    const candidatesListener = onValue(candidatesRef, (snapshot) => {
        snapshot.forEach((childSnapshot) => {
            const candidateData = childSnapshot.val();
            if (candidateData && candidateData.type === "remote") {
                console.log("WebRTC: Received remote ICE candidate");
                if (remoteDescriptionSet) {
                    this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidateData.candidate));
                } else {
                    remoteCandidates.push(candidateData.candidate);
                }
            }
        });
    });

    // Listen for answer
    console.log("WebRTC: Listening for answer");
    const answerListener = onValue(answerRef, (snapshot) => {
        console.log("AAAA snapshot", snapshot);
        const answer = snapshot.val();
        console.log("AAAA", answer);

        if (answer) {
            console.log("WebRTC: Received answer");
            //     // Listen for answer
            console.log("WebRTC: Received answer from Firebase:", answer);
            this.peerConnection?.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
              console.log("what");  
              remoteDescriptionSet = true;
                remoteCandidates.forEach(candidate => this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate)));
                remoteCandidates.length = 0; // Clear the queue
            }).catch(e => console.error("Error setting remote description:", e));
        }
    });

    // Create offer
    console.log("WebRTC: Creating offer");
    this.peerConnection.createOffer().then((offer) => {
        console.log("WebRTC: Offer created, setting local description");
        return this.peerConnection?.setLocalDescription(offer).then(() => {
            console.log("WebRTC: Local description set, storing offer in Firebase");
            // Store offer in Firebase
            return set(offerRef, { type: offer.type, sdp: offer.sdp });
        });
    }).catch((error) => {
        console.error("Error creating offer:", error);
    });

    await dataChannelOpen;

    // Clean up listeners
    // off(candidatesRef, "value", candidatesListener);
    // off(answerRef, "value", answerListener);

    console.log("WebRTC: Connection established");
    // Return the ADB streams
    return this.createAdbStreams();
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
    };

    this.dataChannel.onclose = () => {
      console.log("Data channel closed");
    };
  }

  private createAdbStreams(): { 
    readable: ReadableStream<AdbPacketData>; 
    writable: WritableStream<Consumable<AdbPacketInit>> 
  } {
    // Keep references to class properties
    const dataChannel = this.dataChannel!;
    const peerConnection = this.peerConnection;

    const readable = new WrapReadableStream(new ReadableStream({
      start(controller) {
        dataChannel.onmessage = (event) => {
          controller.enqueue(new Uint8Array(event.data));
        };
      },
      cancel() {
        console.log("Readable stream cancelled");
      }
    })).pipeThrough(new StructDeserializeStream(AdbPacket) as any) as ReadableStream<AdbPacketData>;

    const writable = pipeFrom(
      new MaybeConsumable.WritableStream({
        write(chunk: any) {
          dataChannel.send(chunk);
        },
        close() {
          // Close the data channel and peer connection
          if (dataChannel && dataChannel.readyState === "open") {
            dataChannel.close();
          }
          if (peerConnection) {
            peerConnection.close();
          }
          return Promise.resolve(undefined);
        }
      }),
      new AdbPacketSerializeStream(),
    ) as WritableStream<Consumable<AdbPacketInit>>;

    return { readable, writable };
  }

  async disconnect() {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
  }
}
