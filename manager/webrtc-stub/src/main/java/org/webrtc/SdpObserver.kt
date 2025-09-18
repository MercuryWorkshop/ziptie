package org.webrtc

interface SdpObserver {
    fun onCreateSuccess(sessionDescription: SessionDescription?)
    fun onSetSuccess()
    fun onCreateFailure(error: String?)
    fun onSetFailure(error: String?)
}
