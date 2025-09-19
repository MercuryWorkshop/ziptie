package org.mercuryworkshop.ziptiemanager

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import com.google.firebase.database.GenericTypeIndicator
import kotlinx.coroutines.delay
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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class WebRTCService : Service() {
    private val TAG = "WebRTCService"
    private val CHANNEL_ID = "WebRTCServiceChannel"
    private val NOTIFICATION_ID = 1 // Unique ID for this service's notification
    private var isServiceRunning = false
    private lateinit var database: FirebaseDatabase
    private lateinit var signalingChannel: String

    private var socket: Socket? = null
    private var offerListener: ValueEventListener? = null
    private var candidatesListener: com.google.firebase.database.ChildEventListener? = null
    private var offerRef: DatabaseReference? = null
    private var answerRef: DatabaseReference? = null
    private var candidatesRef: DatabaseReference? = null


    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val coroutineScope = CoroutineScope(Dispatchers.Default)
    private var lastCandidateTime: Long = 0
    private var answerSent = false
    private val ICE_GATHERING_TIMEOUT = 1000L // 1 second

    // WebRTC components
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var remoteDescriptionSet = false
    private val remoteCandidates = mutableListOf<IceCandidate>()
    
    // ICE servers
    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.blackberry.com:3478").createIceServer(),
    )
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "WebRTC Service created")
        createNotificationChannel()
        
        // Initialize Firebase
        database = FirebaseDatabase.getInstance()
        
        // Initialize WebRTC
        initializeWebRTC()
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "WebRTC Service Channel",
                NotificationManager.IMPORTANCE_HIGH
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(serviceChannel)
        }
    }
    
    private fun initializeWebRTC() {
        // Initialize PeerConnectionFactory
        val options = PeerConnectionFactory.InitializationOptions.builder(this)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)

        val encoderFactory = DefaultVideoEncoderFactory(null, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(null)
        val factoryBuilder = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)

        executor.execute { // All WebRTC operations should be on this executor
            peerConnectionFactory = factoryBuilder.createPeerConnectionFactory()
            Log.d(TAG, "WebRTC initialized")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WebRTC Service")
            .setContentText("Running in background...")
            .setSmallIcon(android.R.drawable.sym_def_app_icon) // Using a default Android icon
            .build()

        startForeground(NOTIFICATION_ID, notification)
        Log.d(TAG, "WebRTC Service started as foreground service")
        isServiceRunning = true

        signalingChannel = intent?.getStringExtra("signalingChannel") ?: "default"
        Log.d(TAG, "Starting WebRTC service with signaling channel: $signalingChannel")

        // Set up Firebase references
        offerRef = database.getReference("$signalingChannel/offer")
        answerRef = database.getReference("$signalingChannel/answer")
        candidatesRef = database.getReference("$signalingChannel/candidates")

        // Connect to local ADB server on background thread
        coroutineScope.launch {
            connectToLocalADB()
        }

        executor.execute {
            // Create peer connection
            createPeerConnection()
        }

        // Listen for WebRTC offers
        listenForOffers()

        // Listen for ICE candidates
        listenForCandidates()

        return START_STICKY
    }

    private suspend fun connectToLocalADB() {
        var attempts = 0
        val maxAttempts = 5
        val retryDelayMillis = 5000L // 5 seconds

        while (socket == null || socket?.isConnected == false) {
            if (!isServiceRunning) return // Stop trying if service is being destroyed

            try {
                Log.d(TAG, "Attempting to connect to local ADB server (attempt ${attempts + 1})")
                socket = Socket("127.0.0.1", 9090)
                Log.d(TAG, "Connected to local ADB server")

                // Start a background coroutine to read from the socket and forward to the data channel
                coroutineScope.launch(Dispatchers.IO) {
                    try {
                        val inputStream = socket?.getInputStream()
                        val buffer = ByteArray(40960)
                        var bytesRead: Int
                        while (socket?.isClosed == false) {
                            inputStream?.read(buffer)?.let {
                                bytesRead = it
                                if (bytesRead == -1) {
                                    return@launch
                                }
                                val data = buffer.copyOf(bytesRead)
                                executor.execute {
                                    dataChannel?.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(data), true))
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error reading from ADB socket", e)
                        // Connection lost, attempt to reconnect
                        socket?.close()
                        socket = null
                        if (isServiceRunning) {
                            launch { connectToLocalADB() }
                        }
                    }
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to local ADB server", e)
                attempts++
                if (attempts < maxAttempts) {
                    delay(retryDelayMillis)
                } else {
                    Log.e(TAG, "Max attempts reached for ADB connection. Giving up.")
                    break
                }
            }
        }
    }

    private fun createPeerConnection() {
        executor.execute {
            if (peerConnectionFactory == null) {
                initializeWebRTC()
            }
            val rtcConfig = PeerConnection.RTCConfiguration(iceServers)
            rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN

            peerConnection = peerConnectionFactory?.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(signalingState: PeerConnection.SignalingState?) {
                Log.d(TAG, "Signaling state changed: $signalingState")
            }
            
            override fun onIceConnectionChange(iceConnectionState: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE connection state changed: $iceConnectionState")
                when (iceConnectionState) {
                    PeerConnection.IceConnectionState.CONNECTED -> {
                        Log.d(TAG, "ICE connection connected. Clearing signaling data.")
                        clearSignalingData()
                        answerSent = false
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED, PeerConnection.IceConnectionState.FAILED -> {
                        Log.e(TAG, "ICE connection disconnected or failed. Recreating peer connection.")
                        executor.execute {
                            cleanUpWebRTCResources(false) // Don't dispose factory
                            createPeerConnection()
                        }
                    }
                    else -> {}
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Log.d(TAG, "ICE connection receiving changed: $receiving")
            }

            override fun onIceCandidate(candidate: IceCandidate?) {
                // In batch ICE, candidates are included in the SDP itself
                // so we don't need to collect them separately
                Log.d(TAG, "ICE candidate gathered: ${candidate?.sdp}")
                if (candidate != null) {
                    lastCandidateTime = System.currentTimeMillis()
                    // Start a delayed check to see if ICE gathering is complete
                    executor.execute {
                        Thread.sleep(ICE_GATHERING_TIMEOUT)
                        if (!answerSent && System.currentTimeMillis() - lastCandidateTime >= ICE_GATHERING_TIMEOUT) {
                            // Send answer if we haven't received COMPLETE state
                            sendAnswer()
                        }
                    }
                }
            }

            override fun onIceGatheringChange(iceGatheringState: PeerConnection.IceGatheringState?) {
                Log.d(TAG, "ICE gathering state changed: $iceGatheringState")
                if (iceGatheringState == PeerConnection.IceGatheringState.COMPLETE) {
                    // In batch ICE, send the answer when ICE gathering is complete
                    // All candidates should be included in the SDP
                    executor.execute {
                        // Add a small delay to ensure all candidates are included in the SDP
                        Thread.sleep(100)
                        sendAnswer()
                    }
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
                executor.execute {
                    Log.d(TAG, "Data channel received")
                    dataChannel?.let {
                        this@WebRTCService.dataChannel = it
                        setupDataChannel(it)
                    }
                }
            }

            override fun onRenegotiationNeeded() {
                executor.execute {
                    Log.d(TAG, "Renegotiation needed")
                }
            }
        })

        Log.d(TAG, "Peer connection created")
        }
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
                    val timestamp = offerJson["timestamp"] as? Long
                    if (timestamp != null && System.currentTimeMillis() - timestamp > 5 * 60 * 1000) { // 5 minutes
                        Log.d(TAG, "Received expired offer, deleting it.")
                        offerRef?.removeValue()
                        return
                    }

                    Log.d(TAG, "Received offer: $offerJson")
                    Log.d(TAG, "Received offer: $offerJson")
                    try {
                        offerRef?.removeValue() // Clear the offer immediately
                        // Create and send answer (candidates are now sent separately)
                        createAndSendAnswer(offerJson)
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
        candidatesListener = object : com.google.firebase.database.ChildEventListener {
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
                            executor.execute {
                                if (remoteDescriptionSet) {
                                    peerConnection?.addIceCandidate(candidate)
                                } else {
                                    remoteCandidates.add(candidate)
                                }
                            }
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
        }
        candidatesRef?.addChildEventListener(candidatesListener!!)
    }
    
    private fun createAndSendAnswer(offerMap: Map<String, Any>) {
        executor.execute {
            try {
                val offer = SessionDescription(
                    SessionDescription.Type.OFFER,
                    offerMap["sdp"] as String
                )

                if (peerConnection?.signalingState() != PeerConnection.SignalingState.STABLE) {
                    Log.w(TAG, "Received offer in non-stable signaling state: ${peerConnection?.signalingState()}. Ignoring.")
                    return@execute
                }

                peerConnection?.setRemoteDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        remoteDescriptionSet = true
                        listenForCandidates() // Start listening for candidates only after offer is set
                        // Add any remote candidates that were received before the remote description was set
                        remoteCandidates.forEach { candidate ->
                            peerConnection?.addIceCandidate(candidate)
                        }
                        remoteCandidates.clear()

                        // Wait for ICE gathering to complete before sending answer
                        peerConnection?.createAnswer(object : SdpObserver {
                            override fun onCreateSuccess(answer: SessionDescription?) {
                                peerConnection?.setLocalDescription(object : SdpObserver {
                                    override fun onSetSuccess() {
                                        // In batch ICE, don't send the answer yet
                                        // Wait for ICE gathering to complete
                                        Log.d(TAG, "Local description set, waiting for ICE gathering to complete")
                                    }
                                    override fun onSetFailure(error: String?) {
                                        Log.e(TAG, "setLocalDescription failed: $error")
                                    }
                                    override fun onCreateSuccess(p0: SessionDescription?) {}
                                    override fun onCreateFailure(p0: String?) {}
                                }, answer)
                            }
                            override fun onCreateFailure(error: String?) { Log.e(TAG, "createAnswer failed: $error") }
                            override fun onSetSuccess() {}
                            override fun onSetFailure(p0: String?) {}
                        }, MediaConstraints())
                    }
                    override fun onSetFailure(error: String?) { Log.e(TAG, "setRemoteDescription failed: $error") }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, offer)

            } catch (e: Exception) {
                Log.e(TAG, "Error creating answer", e)
            }
        }
    }

    private fun clearSignalingData() {
        offerRef?.removeValue()
        answerRef?.removeValue()
        candidatesRef?.removeValue()
        Log.d(TAG, "Firebase signaling data cleared.")
    }

    private fun cleanUpWebRTCResources(disposeFactory: Boolean) {
        executor.execute {
            dataChannel?.close()
            dataChannel?.dispose()
            dataChannel = null

            peerConnection?.close()
            peerConnection?.dispose()
            peerConnection = null

            if (disposeFactory) {
                peerConnectionFactory?.dispose()
                peerConnectionFactory = null
            }
            Log.d(TAG, "WebRTC resources cleaned up. Dispose factory: $disposeFactory")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isServiceRunning = false
        super.onDestroy()
        Log.d(TAG, "WebRTC Service destroyed")

        // Clean up resources
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing connections", e)
        }

        // Clean up WebRTC resources
        cleanUpWebRTCResources(true)
        executor.shutdown()

        // Clean up Firebase listeners
        offerListener?.let {
            offerRef?.removeEventListener(it)
        }
        candidatesListener?.let {
            candidatesRef?.removeEventListener(it)
        }
    }

    private fun sendAnswer() {
        executor.execute {
            if (!answerSent) {
                answerSent = true
                val answer = peerConnection?.localDescription
                val answerMap = mapOf(
                    "type" to "answer",
                    "sdp" to answer?.description,
                    "timestamp" to System.currentTimeMillis()
                )
                answerRef?.setValue(answerMap)
                Log.d(TAG, "Sent answer with all candidates")
            }
        }
    }
}