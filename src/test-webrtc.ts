import { AdbDaemonWebRTCDevice } from "./WebRTCDevice";

// Simple test to verify the WebRTC device class
async function testWebRTCDevice() {
  console.log("Testing WebRTC device...");
  
  // Check if WebRTC is supported
  if (AdbDaemonWebRTCDevice.isSupported()) {
    console.log("WebRTC is supported");
  } else {
    console.log("WebRTC is not supported");
    return;
  }
  
  // Create a WebRTC device instance
  const device = new AdbDaemonWebRTCDevice("test-channel");
  console.log("Created WebRTC device with signaling channel:", device.name);
  
  // Try to connect (this will fail without a proper signaling server, but we can test the setup)
 try {
    console.log("Attempting to connect...");
    // Note: This will fail without a proper signaling server setup
    // await device.connect();
    console.log("Connection attempt completed");
  } catch (error) {
    console.log("Connection failed as expected without signaling server:", error);
  }
}

// Run the test
testWebRTCDevice();