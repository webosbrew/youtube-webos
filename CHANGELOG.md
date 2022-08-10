# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.4.0] - 2022/08/11

### Added

- Option to hide YouTube logo (avoid OLED burning)

## [0.3.1] - 2022/01/27

### Fixed

- [#24](https://github.com/webosbrew/youtube-webos/pull/24): Fixed playback time
  tracking again

## [0.3.0] - 2022/01/15

### Fixed

- [#14](https://github.com/webosbrew/youtube-webos/pull/14): Fixed voice search
  on certain TV models
- [#21](https://github.com/webosbrew/youtube-webos/pull/21): Fixed screensaver
  kicking in during non-16:9 videos playback

### Changed

- [#19](https://github.com/webosbrew/youtube-webos/pull/19): Updated internal
  dependencies, cleaned up build setup

## [0.2.1] - 2021/12/26

## Fixed

- Fixed rendering on 720p TVs
- Disabled update prompt on startup

## [0.2.0] - 2021/12/23

### Added

- Added support for autostart (requires manual setup, see
  [README](README.md#autostart))

### Fixed

- Fixed deeplinking from voice search results
- Fixed in-app voice search button on webOS 5.x
- Fixed screensaver kicking in on sponsor segment skips
- Fixed playback time tracking

## [0.1.1] - 2021/11/21

### Fixed

- Use alternative SponsorBlock API URL to work around untrusted Let's Encrypt
  certificates
- Increase initial notification delay

## [0.1.0] - 2021/11/14

### Added

- [#10](https://github.com/FriedChickenButt/youtube-webos/issues/1): Added SponsorBlock integration
- Added configuration UI activated by pressing green button

## [0.0.2]

### Added

- [#2](https://github.com/FriedChickenButt/youtube-webos/issues/2): Added DIAL startup support.
- [#3](https://github.com/FriedChickenButt/youtube-webos/issues/3): Added webOS 3.x support.
- Enabled quick start.
- Disabled default splash screen

### Fixed

- Disabled back button behaviour to open the Home deck.

## [0.0.1]

### Added

- Created basic web app which launches YouTube TV.

[Unreleased]: https://github.com/webosbrew/youtube-webos/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/webosbrew/youtube-webos/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/webosbrew/youtube-webos/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/webosbrew/youtube-webos/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/webosbrew/youtube-webos/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/webosbrew/youtube-webos/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/webosbrew/youtube-webos/compare/0.0.2...v0.1.0
[0.0.2]: https://github.com/webosbrew/youtube-webos/compare/0.0.1...0.0.2
[0.0.1]: https://github.com/webosbrew/youtube-webos/releases/tag/0.0.1
