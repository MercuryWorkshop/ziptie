package org.webrtc

class DataChannel {
    class Init {
        var ordered: Boolean = true
        var maxRetransmits: Int = -1
    }

    enum class State { OPEN, CLOSING, CLOSED }

    interface Observer {
        fun onBufferedAmountChange(previousAmount: Long)
        fun onStateChange()
        fun onMessage(buffer: Buffer?)
    }

    class Buffer(val data: java.nio.ByteBuffer, val binary: Boolean)

    fun registerObserver(observer: Observer) {}
    fun state(): State = State.CLOSED
    fun close() {}
    fun dispose() {}
}
