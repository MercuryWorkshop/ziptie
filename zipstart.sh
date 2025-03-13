#!/bin/bash

packages=(clang termux-x11 pulseaudio proot-distro xorgproto virglrenderer-android)
for package in "${packages[@]}"; do
  if ! dpkg -l | grep -q "$package"; then
    echo "installing $package"
    pkg install -y "$package"
  fi
done


echo "compiling zipmouse.c"
gcc /data/local/tmp/zipmouse.c -o ./zipmouse -lX11 -lXtst


echo "killing previous instances"
kill "$(<x11pid)" 2>/dev/null
kill "$(<zipmousepid)" 2>/dev/null
kill "$(<virglpid)" 2>/dev/null

export DISPLAY=:0
termux-x11 :0 &
x11pid=$!
sleep 2
pulseaudio --start --exit-idle-time=-1
pacmd load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1

./zipmouse &
zipmousepid=$!

virgl_test_server_android &
virglpid=$!

sleep 2 # TODO: WAIT for x and mouse to start

echo "$x11pid" > x11pid
echo "$zipmousepid" > zipmousepid
echo "$virglpid" > virglpid

echo "DONE!"
echo >pipe
