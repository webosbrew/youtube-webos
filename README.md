<h1 align="center">
  <a href="https://github.com/webosbrew/youtube-webos">YouTube Ad-Free</a>
</h1>
<p align="center">
  <img src="https://img.shields.io/github/stars/webosbrew/youtube-webos?style=flat-square&logo=github" alt="GitHub Stars">
  <img src="https://img.shields.io/github/v/release/webosbrew/youtube-webos?style=flat-square" alt="Latest Release">
  <img src="https://img.shields.io/github/contributors/webosbrew/youtube-webos?style=flat-square" alt="Contributors">
  <img src="https://img.shields.io/github/downloads/webosbrew/youtube-webos/total?style=flat-square" alt="Total Downloads">
  <img src="https://img.shields.io/badge/LG-webOS-000000?logo=webos&logoColor=white&style=flat-square" alt="webOS">
</p>
<br>
<p align="center">
  YouTube app for webOS TV with ad blocking and other enhancements
</p>
<br>

![Configuration Screen](./screenshots/1_sm.jpg?raw=true)  
![Segment Skipped](./screenshots/2_sm.jpg?raw=true)

---

## Features

- Ad Blocking
- [SponsorBlock](https://sponsor.ajay.app/) Integration
- [Autostart Support](#autostart)
- Force Highest Video Quality
- Audio-Only Mode (🟦 Blue button on remote)
- Full Animation Support
- Magic Remote Scroll-Based Video Seeking
- Shorts Removal
- Higher-Quality Thumbnails
- On-Screen Clock Overlay
- YouTube Logo Removal

> Press the 🟩 **Green** button on your remote to access the configuration screen.

---

## Requirements

- Uninstall the official YouTube app before installing this one.

---

## Installation

You can install the app using one of the following methods:

- **[webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):**
  App is available in the official webOSbrew repository.
- **[Device Manager](https://github.com/webosbrew/dev-manager-desktop):**
  Use a pre-built `.ipk` file from the [Releases](https://github.com/webosbrew/youtube-webos/releases) page.
- **[Command Line (webOS CLI)](https://webostv.developer.lge.com/develop/tools/cli-installation):** Configure the tools [below](#development-tv-setup)

  ```sh
  ares-install youtube-webos.ipk
  ```

---

## Autostart

To enable autostart, run the following command needs to be executed via _SSH_ or _Telnet_:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

This allows the app to show up as an input source and launch automatically if it was the last used app. It will remain active in the background for faster startup (minor increase in idle memory usage).

To disable autostart:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

---

## Building from Source

```sh
git clone https://github.com/webosbrew/youtube-webos.git
cd youtube-webos

# Install dependencies
npm install

# Build and package the app
npm run build
npm run package
```

The `.ipk` file will be generated in the main project directory.

---

## Development Setup (TV)

Uses [webOS CLI tools](https://webostv.developer.lge.com/develop/tools/cli-introduction).

### CLI Installation & Setup

Delete any existing or older webOS CLI before installing the new one:

```sh
npm uninstall -g @webosose/ares-cli
npm install -g @webos-tools/cli
ares -V # verify installation
```

### On the TV

1. Create an [LG Developer account](https://webostv.developer.lge.com/login)
2. Install the [**Developer Mode** app](https://in.lgappstv.com/main/tvapp/detail?appId=232503) from the LG Content Store
3. Navigate to the app, Log-in in with LG Developer Credentials and enable:
   - Developer Mode
   - Key Server

### Configure CLI with TV

```sh
ares-setup-device
```

Follow the prompts:

- Add device
- Enter IP from the Developer Mode app
- Use default values unless needed
- Enter 6-digit passphrase shown on the TV screen

Verify:

```sh
ares-setup-device --list
```

Sample output:

```
name            deviceinfo                     connection  profile    passphrase
--------------  -----------------------------  ----------  -------    ----------
mytv (default)  prisoner@192.168.137.102:9922  ssh         tv         EF32E8
```

---

## Installing and Launching

```sh
# In project root
npm install # not required if already done
npm run build
npm run package

ares-install -d <device_name> <your_app_file>.ipk
ares-launch -d <device_name> youtube.leanback.v4
ares-inspect -d <device_name> --app youtube.leanback.v4
```

---

## Alternate Setup (Homebrew / Rooted TV)

1. Enable SSH via Homebrew Channel
2. Generate SSH key:
   ```sh
   ssh-keygen -t rsa
   ```
3. Copy `id_rsa` to `~/.ssh` (Windows: `%USERPROFILE%\.ssh`)
4. Append `id_rsa.pub` to `/home/root/.ssh/authorized_keys` on the TV
5. Set up device:

   ```sh
   ares-setup-device -a webos \
     -i "username=root" \
     -i "privatekey=id_rsa" \
     -i "passphrase=SSH_KEY_PASSPHRASE" \
     -i "host=TV_IP" \
     -i "port=22"
   ```

---

## Quick Commands

### Install & Launch

```sh
npm run deploy
```

### Manual Launch

```sh
npm run launch
```

To launch a specific video directly:

```sh
npm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'
```
