#!/bin/bash
test if packages are installed
if ! which termux-x11 && ! which pulseaudio; then
  echo "COULDNT FIND PACKAGES"
fi
pkill -f x11;

echo "compiling zipmouse.c"
# make sure xorgproto is installed
gcc /data/local/tmp/zipmouse.c -o ./zipmouse -lX11 -lXtst

export DISPLAY=:0
termux-x11 :0 &
x11pid=$!
sleep 2
pulseaudio --start --exit-idle-time=-1
pacmd load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1

# start mouse daemon
./zipmouse &
zipmousepid=$!

sleep 2 # TODO: WAIT for x and mouse to start

echo "x11pid: $x11pid"
echo "zipmousepid: $zipmousepid"
echo "DONE!"
echo >pipe
