# Ziptie

Ziptie allows you to connect to your android device from a website or standalone html file to access a linux container.

This can be useful if you're using a device you don't trust/control and need to perform a certain task, need to manage your android phone wirelessly, or just need an arm linux container for testing.

To use download the [standalone html file](https://github.com/MercuryWorkshop/ziptie/releases/download/latest/standalone.html) and connect to your android. ADB must be enabled

To use wireless mode you must download the manager app and run `adb tcpip 9090` beforehand


## building instructions
```
cd server
./gradlew clean assembleRelease
cd ..
pnpm i
npx fetch-scrcpy-server 3.1
pnpm vite build
```
