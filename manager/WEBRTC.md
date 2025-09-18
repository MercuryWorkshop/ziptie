# WebRTC Implementation for Ziptie Manager

This document explains how to use the WebRTC connection feature in the Ziptie Manager Android app.

## Overview

The Ziptie Manager now supports WebRTC connections for connecting to the desktop client. This provides an alternative to WebSocket connections and can offer better performance in some scenarios.

## Setup

1. Make sure you have the latest version of the Ziptie Manager app installed
2. The app automatically includes Firebase dependencies for signaling

## Usage

1. Open the Ziptie Manager app
2. Enter a signaling channel name in the "WebRTC Signaling Channel" field
3. Tap the "Start WebRTC" button
4. On the desktop client, use the same signaling channel name to connect

## How It Works

The WebRTC connection process:

1. Both peers connect to the same Firebase Realtime Database
2. They use the signaling channel name to exchange connection information
3. Once connected, ADB data is transmitted directly between peers via WebRTC data channels

## Troubleshooting

- If connection fails, check that both peers are using the same signaling channel name
- Ensure your Firebase configuration is correct
- Check Android logs for any WebRTC-related errors