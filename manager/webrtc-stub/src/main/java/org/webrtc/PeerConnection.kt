package org.webrtc

class PeerConnection {
    enum class SdpSemantics { UNIFIED_PLAN }
    class RTCConfiguration(val iceServers: List<IceServer>) {
        var sdpSemantics: SdpSemantics = SdpSemantics.UNIFIED_PLAN
    }

    class IceServer private constructor(val uri: String) {
        companion object {
            fun builder(uri: String) = IceServer(uri)
        }
        fun createIceServer() = this
    }

    interface Observer
    fun dispose() {}
    fun close() {}
    fun createDataChannel(label: String, init: DataChannel.Init): DataChannel? = null

    companion object {
        fun createPeerConnection(config: RTCConfiguration, observer: Observer): PeerConnection? = null
    }
}
