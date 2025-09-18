package org.webrtc

class PeerConnectionFactory {
    class InitializationOptions private constructor() {
        class Builder(val context: Any) {
            fun setEnableInternalTracer(enable: Boolean) = this
            fun createInitializationOptions() = InitializationOptions()
        }
    }

    companion object {
        fun initialize(options: InitializationOptions) {}
        fun builder() = Builder()
    }

    class Builder {
        fun setVideoEncoderFactory(factory: Any) = this
        fun setVideoDecoderFactory(factory: Any) = this
        fun createPeerConnectionFactory(): PeerConnectionFactory = PeerConnectionFactory()
    }

    fun dispose() {}
}
