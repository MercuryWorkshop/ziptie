package org.mercuryworkshop.ziptiemanager

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import com.google.firebase.database.GenericTypeIndicator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.*
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.net.Socket
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class WebRTCService : Service() {
    private val TAG = "WebRTCService"
    private lateinit var database: FirebaseDatabase
    private lateinit var signalingChannel: String

    private var socket: Socket? = null
    private var offerListener: ValueEventListener? = null
    private var candidatesListener: ValueEventListener? = null
    private var offerRef: DatabaseReference? = null
    private var answerRef: DatabaseReference? = null
    private var candidatesRef: DatabaseReference? = null
    private val executor = Executors.newSingleThreadExecutor()
    
    private val coroutineScope = CoroutineScope(Dispatchers.Default)

    // WebRTC components
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    
    // ICE servers
    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.voip.blackberry.com:3478").createIceServer()
    )
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "WebRTC Service created")
        
        // Initialize Firebase
        database = FirebaseDatabase.getInstance()
        
        // Initialize WebRTC
        initializeWebRTC()
    }
    
    private fun initializeWebRTC() {
        // Initialize PeerConnectionFactory
        val options = PeerConnectionFactory.InitializationOptions.builder(this)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)
        
        val encoderFactory = SoftwareVideoEncoderFactory()
        val decoderFactory = SoftwareVideoDecoderFactory()
        
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
            
        Log.d(TAG, "WebRTC initialized")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        signalingChannel = intent?.getStringExtra("signalingChannel") ?: "default"
        Log.d(TAG, "Starting WebRTC service with signaling channel: $signalingChannel")
        
        // Set up Firebase references
        offerRef = database.getReference("$signalingChannel/offer")
        answerRef = database.getReference("$signalingChannel/answer")
        candidatesRef = database.getReference("$signalingChannel/candidates")
        
        // Connect to local ADB server on background thread
        executor.execute {
            connectToLocalADB()
            
            // Create peer connection
            createPeerConnection()
            
            // Listen for WebRTC offers
            listenForOffers()
            
            // Listen for ICE candidates
            listenForCandidates()
        }
        
        return START_STICKY
    }
    
    private fun connectToLocalADB() {
        try {
            socket = Socket("127.0.0.1", 9090)
            Log.d(TAG, "Connected to local ADB server")

            // Start a background thread to read from the socket and forward to the data channel
            Thread {
                try {
                    val inputStream = socket?.getInputStream()
                    val buffer = ByteArray(40960)
                    var bytesRead: Int = 0
                    while (socket?.isClosed == false && inputStream?.read(buffer).also { bytesRead = it!! } != -1) {
                        val data = buffer.copyOf(bytesRead)
                        dataChannel?.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(data), true))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error reading from ADB socket", e)
                }
            }.start()

        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect to local ADB server", e)
        }
    }
    
    private fun createPeerConnection() {
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers)
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        
        peerConnection = peerConnectionFactory?.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(signalingState: PeerConnection.SignalingState?) {
                Log.d(TAG, "Signaling state changed: $signalingState")
            }
            
            override fun onIceConnectionChange(iceConnectionState: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE connection state changed: $iceConnectionState")
            }
            
            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Log.d(TAG, "ICE connection receiving changed: $receiving")
            }
            
            override fun onIceGatheringChange(iceGatheringState: PeerConnection.IceGatheringState?) {
                Log.d(TAG, "ICE gathering state changed: $iceGatheringState")
            }
            
            override fun onIceCandidate(candidate: IceCandidate?) {
                Log.d(TAG, "ICE candidate generated")
                candidate?.let {
                    sendIceCandidate(it)
                }
            }
            
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
                Log.d(TAG, "ICE candidates removed")
            }
            
            override fun onAddStream(stream: MediaStream?) {
                Log.d(TAG, "Media stream added")
            }
            
            override fun onRemoveStream(stream: MediaStream?) {
                Log.d(TAG, "Media stream removed")
            }
            
            override fun onDataChannel(dataChannel: DataChannel?) {
                Log.d(TAG, "Data channel received")
                dataChannel?.let {
                    this@WebRTCService.dataChannel = it
                    setupDataChannel(it)
                }
            }
            
            override fun onRenegotiationNeeded() {
                Log.d(TAG, "Renegotiation needed")
            }
        })
        
        Log.d(TAG, "Peer connection created")
    }
    
    private fun setupDataChannel(dataChannel: DataChannel) {
        dataChannel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {
//                Log.d(TAG, "Buffered amount changed: $previousAmount")
            }
            
            override fun onStateChange() {
//                Log.d(TAG, "Data channel state changed: ${dataChannel.state()}")
//                if (dataChannel.state() == DataChannel.State.OPEN) {
//                    Log.d(TAG, "Data channel opened")
//                }
            }
            
            override fun onMessage(buffer: DataChannel.Buffer?) {
//                Log.d(TAG, "Message received on data channel")
                buffer?.let {
                    // Forward data to ADB server
                    val data = ByteArray(it.data.remaining())
                    it.data.get(data)
                    socket?.getOutputStream()?.write(data)
                }
            }
        })
    }
    
    private fun listenForOffers() {
        offerListener = object : ValueEventListener {
            override fun onDataChange(dataSnapshot: DataSnapshot) {
                val offerJson = dataSnapshot.getValue(object : GenericTypeIndicator<Map<String, Any>>() {})
                if (offerJson != null) {
                    Log.d(TAG, "Received offer: $offerJson")
                    try {
                        // Create and send answer
                        createAndSendAnswer(offerJson)
                        offerRef?.removeValue() // Clear the offer after processing
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing offer", e)
                    }
                }
            }
            
            override fun onCancelled(databaseError: DatabaseError) {
                Log.e(TAG, "Failed to read offer", databaseError.toException())
            }
        }
        
        offerRef?.addValueEventListener(offerListener!!)
    }
    
    private fun listenForCandidates() {
        
        
        candidatesRef?.addChildEventListener(object : com.google.firebase.database.ChildEventListener {
            override fun onChildAdded(dataSnapshot: DataSnapshot, previousChildName: String?) {
                val candidateData = dataSnapshot.getValue(object : GenericTypeIndicator<Map<String, Any>>() {})
                if (candidateData != null && candidateData["type"] == "local") {
                    Log.d(TAG, "Received remote ICE candidate: $candidateData")
                    try {
                        val candidateMap = candidateData["candidate"] as? Map<String, Any>
                        if (candidateMap != null) {
                            val candidate = IceCandidate(
                                candidateMap["sdpMid"] as String,
                                (candidateMap["sdpMLineIndex"] as Number).toInt(),
                                candidateMap["candidate"] as String
                            )
                            peerConnection?.addIceCandidate(candidate)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error adding ICE candidate", e)
                    }
                }
            }
            
            override fun onChildChanged(dataSnapshot: DataSnapshot, previousChildName: String?) {}
            override fun onChildRemoved(dataSnapshot: DataSnapshot) {}
            override fun onChildMoved(dataSnapshot: DataSnapshot, previousChildName: String?) {}
            override fun onCancelled(databaseError: DatabaseError) {
                Log.e(TAG, "Failed to read candidates", databaseError.toException())
            }
        })
    }
    
    private fun createAndSendAnswer(offerMap: Map<String, Any>) {
        coroutineScope.launch {
            try {
                val offer = SessionDescription(
                    SessionDescription.Type.OFFER,
                    offerMap["sdp"] as String
                )

                peerConnection?.setRemoteDescriptionSdp(offer)
                val answer = peerConnection?.createAnswerSdp(MediaConstraints())
                peerConnection?.setLocalDescriptionSdp(answer)

                val answerMap = mapOf(
                    "type" to "answer",
                    "sdp" to answer?.description
                )
                answerRef?.setValue(answerMap)
                answerRef?.removeValue() // Clear the answer after sending
                Log.d(TAG, "Sent answer")
            } catch (e: Exception) {
                Log.e(TAG, "Error creating answer", e)
            }
        }
    }

    private suspend fun PeerConnection.setRemoteDescriptionSdp(sdp: SessionDescription) = suspendCoroutine<Unit> {
        setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                it.resume(Unit)
            }

            override fun onSetFailure(error: String?) {
                it.resumeWithException(Exception("onSetFailure: $error"))
            }

            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sdp)
    }

    private suspend fun PeerConnection.createAnswerSdp(mediaConstraints: MediaConstraints) = suspendCoroutine<SessionDescription> {
        createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                if (sdp != null) {
                    it.resume(sdp)
                } else {
                    it.resumeWithException(Exception("onCreateSuccess: sdp is null"))
                }
            }

            override fun onCreateFailure(error: String?) {
                it.resumeWithException(Exception("onCreateFailure: $error"))
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, mediaConstraints)
    }

    private suspend fun PeerConnection.setLocalDescriptionSdp(sdp: SessionDescription?) = suspendCoroutine<Unit> {
        setLocalDescription(object : SdpObserver {
            override fun onSetSuccess() {
                it.resume(Unit)
            }

            override fun onSetFailure(error: String?) {
                it.resumeWithException(Exception("onSetFailure: $error"))
            }

            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sdp)
    }
    
    private fun sendIceCandidate(candidate: IceCandidate) {
        executor.execute {
            try {
                val candidateMap = mapOf(
                    "sdpMid" to candidate.sdpMid,
                    "sdpMLineIndex" to candidate.sdpMLineIndex,
                    "sdp" to candidate.sdp
                )
                
                val data = mapOf(
                    "type" to "remote",
                    "candidate" to candidateMap
                )
                
                val newCandidateRef = candidatesRef?.push()
                newCandidateRef?.setValue(data)
                Log.d(TAG, "Sent ICE candidate")
            } catch (e: Exception) {
                Log.e(TAG, "Error sending ICE candidate", e)
            }
        }
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "WebRTC Service destroyed")
        
        // Clean up resources
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing connections", e)
        }
        
        // Clean up WebRTC resources
        dataChannel?.close()
        dataChannel?.dispose()
        peerConnection?.close()
        peerConnection?.dispose()
        peerConnectionFactory?.dispose()
        
        // Clean up Firebase listeners
        offerListener?.let { 
            offerRef?.removeEventListener(it)
        }
        candidatesListener?.let {
            candidatesRef?.removeEventListener(it)
        }
        
        // Shutdown executor
        executor.shutdown()
    }
}