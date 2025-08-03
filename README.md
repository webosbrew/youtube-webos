# [Youtube-WebOS](https://github.com/webosbrew/youtube-webos)

YouTube App for LG WebOS with Extended Functionalities

![Configuration Screen](./screenshots/1_sm.jpg?raw=true)
![Segment Skipped](./screenshots/2_sm.jpg?raw=true)

## Features

- **Advertisements Blocking**
- [SponsorBlock](https://sponsor.ajay.app/) Integration
- [Autostart](#autostart)
- Force Max-Video quality
- Audio-Only Mode (Press 🟦 Blue Button on Remote)
- Force Full Animation
- Magic Remote Scroll based Video Seeking
- YT Shorts Removal
- Upgraded Thumbnail Quality
- Display Time in Overlay
- Remove Youtube Logo
  <br>

- **Note:** Configuration screen can be opened by pressing 🟩 GREEN button on the remote.

## Pre-Requisites

- Official YouTube app needs to be uninstalled before installation.

## Installation

- Use [WebOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) - App is published in official webosbrew repo
- Use [Device Manager](https://github.com/webosbrew/dev-manager-desktop) App - See [Releases](https://github.com/webosbrew/youtube-webos/releases) for a
  prebuilt `.ipk` binary file
- Use [WebOS TV CLI Tools](https://webostv.developer.lge.com/develop/tools/cli-installation) -
  `ares-install youtube...ipk` (For more information on configuring the webOS CLI tools, see [below](#development-tv-setup))

## Configuration

Configuration screen can be opened by pressing 🟩 GREEN button on the remote.

### Autostart

In order to autostart an application the following command needs to be executed
via SSH or Telnet:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

This will make "YouTube AdFree" display as an eligible input application (next to HDMI/Live TV, etc...) and if it was the last selected input, it will be automatically launched when turning on the TV.

This will also greatly increase startup performance, since it will be runnning constantly in the background, at the cost of increased idle memory usage. <small>(So far, relatively unnoticable in normal usage)</small>

In order to disable autostart run this:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

## Building

- Clone the repository & move to project directory.

  ```sh
  git clone https://github.com/webosbrew/youtube-webos.git

  cd youtube-webos
  ```

- Install dependencies & Build the App, this will generate a `*.ipk` file.

  ```sh
  # Install dependencies (need to do this only when updating local  repository / package.json is changed)
  npm install

  npm run build && npm run package
  ```

## Development TV setup

These instructions use the [WebOS CLI tools](https://github.com/webos-tools/cli). See <https://webostv.developer.lge.com/develop/tools/cli-introduction> for more information.

### Configuring WebOS CLI tools with Developer Mode App

This is partially based on <https://webostv.developer.lge.com/develop/getting-started/developer-mode-app>.

- Make sure you have webos-cli and tools installed :
  - Uninstall existing or old unsupported webos-cli's
    ```sh
    # Make sure to uninstall existing or old webos-cli's  before installing new one
    npm uninstall -g @webosose/ares-cli
    npm install -g @webos-tools/cli
    ```
  - Install latest webos-cli from npm
    ```sh
    npm install -g @webos-tools/cli
    ares -V
    ```
- Create an [LG Developer Account](https://webostv.developer.lge.com/login) you don't have one.
- Install 'Developer Mode' app from LG Content Store
- Navigate to 'Developer Mode' app. Enter your LG Developer Account credentials when propmted :
  - Enable Developer Mode
  - Enable key server
- Configure the device using `ares-setup-device`, it will prompt you step-by-step :

  - Procceed with `add` device, give in a `device_name` & go with default values, change any if required.
  - When prompted for `IP`; enter the `IP` displayed in 'developer mode' app. Go with default `Port` & `Username`.
  - Similarly, when prompted for `PASSPHRASE` enter the 6-character passphrase printed on screen in 'developer mode' app
  - Once done, `save` your configuration & confirm your device entry with `ares-setup-device --list`.<br><br>

  ```sh
  PS C:\Users\Jesvi Jonathan\Documents\git\youtube-webos\dist> ares-setup-device --list
  name            deviceinfo                     connection  profile    passphrase
  --------------  -----------------------------  ----------  -------    ----------
  mytv (default)  prisoner@192.168.137.102:9922  ssh         tv         EF32E8
  emulator        developer@127.0.0.1:6622       ssh         tv
  ```

  <small>The newly configured TV-device should be visible. Yay !</small><br><br>

- To build & launch

  ```sh
  # Navigate to 'dist' directory
  cd ./dist

  # remove old builds
  rm ../*.ipk

  # install dependancies (required only once)
  npm install

  # build project
  npm run build
  npm run package

  # Make sure to modify below attributes <device_name> to a device name from 'ares-device-list'.
  # & <ipk_file_name> to the actual exported ipk file's name. (Will present in main project directory after build)

  # Install / Sideload IPK on TV
  ares-install -d <device_name> ../<ipk_file_name>
  # Launch app on TV
  ares-launch -d <device_name> youtube.leanback.v4
  # Debug & Inspect app
  ares-inspect -d <device_name> --app youtube.leanback.v4
  ```

<br>
And just like that, you are pretty much all set for development.

### Configuring webOS CLI tools with Homebrew Channel / root

- Enable SSH in Homebrew Channel app
- Generate SSH key on developer machine (`ssh-keygen -t rsa`)
- Copy the private key (`id_rsa`) to the `~/.ssh` directory (or `%USERPROFILE%\.ssh` on Windows) on the local computer
- Append the public key (`id_rsa.pub`) to the `/home/root/.ssh/authorized_keys` file on the TV
- Configure the device using `ares-setup-device` (`-a` may need to be replaced with `-m` if device named `webos` is already configured)
  - `privatekey` path is relative to `${HOME}/.ssh` (Windows: `%USERPROFILE%\.ssh`)

```sh
ares-setup-device -a webos -i "username=root" -i "privatekey=id_rsa" -i "passphrase=SSH_KEY_PASSPHRASE" -i "host=TV_IP" -i "port=22"
```

## Installation

```sh
npm run deploy
```

## Launching

- The app will be available in the TV's app list. You can also launch it using the webOS CLI tools.

```sh
npm run launch
```

To jump immediately into some specific video use:

```sh
npm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'
```
