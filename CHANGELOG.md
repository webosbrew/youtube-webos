# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.6] - 2025/01/05

### Fixed

- [#235](https://github.com/webosbrew/youtube-webos/pull/235): Fix shorts (@fire332)

## [0.3.5] - 2024/12/27

### Added

- [#201](https://github.com/webosbrew/youtube-webos/pull/201): Blocked shorts in subscriptions tab (@JaCzekanski)
- [#236](https://github.com/webosbrew/youtube-webos/pull/236): Add option to upgrade thumbnail quality (@fire332)

### Fixed

- [#104](https://github.com/webosbrew/youtube-webos/pull/104): Disabled SponsorBlock on previews (@alyyousuf7)
- [#204](https://github.com/webosbrew/youtube-webos/pull/204): Fixed transparency under UI (@atomjack; thanks to @reisxd)
- [#239](https://github.com/webosbrew/youtube-webos/pull/239): Fix missing math font (@fire332)
- [#240](https://github.com/webosbrew/youtube-webos/pull/240): Fix missing voice search (@fire332)
- [#242](https://github.com/webosbrew/youtube-webos/pull/242): Fix checkbox click in the YTAF config UI (@fire332)

### Changed

- [#179](https://github.com/webosbrew/youtube-webos/pull/179), [#183](https://github.com/webosbrew/youtube-webos/pull/183): Updated CLI instructions (@throwaway96, @ShalokShalom)
- [#206](https://github.com/webosbrew/youtube-webos/pull/206): Added old WebKit to targeted browsers (@throwaway96)
- [#208](https://github.com/webosbrew/youtube-webos/pull/208): Changed description of enableSponsorBlockMusicOfftopic setting (@throwaway96)
- [#234](https://github.com/webosbrew/youtube-webos/pull/234): Update dependencies (@fire332)
- [#238](https://github.com/webosbrew/youtube-webos/pull/238): Misc dev changes (@fire332)

## [0.3.4] - 2024/04/23

### Added

- [#164](https://github.com/webosbrew/youtube-webos/pull/164): Added an issue template for bugs (@throwaway96)

### Changed

- [#146](https://github.com/webosbrew/youtube-webos/pull/146): Updated a bunch of dev stuff (@fire332)
- [#150](https://github.com/webosbrew/youtube-webos/pull/150): Added myself to FUNDING.yml (@throwaway96)

## [0.3.3] - 2024/03/31

### Added

- [#142](https://github.com/webosbrew/youtube-webos/pull/141): Blocked some additional ads (@throwaway96)
- [#144](https://github.com/webosbrew/youtube-webos/pull/144): Added support for config change listeners (@throwaway96)
- [#149](https://github.com/webosbrew/youtube-webos/pull/149): Added ability to hide YouTube logo (@throwaway96; thanks to @fire332 and @tomikaka22)

### Fixed

- [#103](https://github.com/webosbrew/youtube-webos/pull/103): Fixed SponsorBlock on videos with chapters (@alyyousuf7)
- [#131](https://github.com/webosbrew/youtube-webos/pull/131): Fixed minor README issue (@ANewDawn)
- [#141](https://github.com/webosbrew/youtube-webos/pull/141): Fixed black background behind video menu (@throwaway96; thanks to @reisxd)
- [#143](https://github.com/webosbrew/youtube-webos/pull/143): Fixed duplicate click bug (@throwaway96)

### Changed

- [#128](https://github.com/webosbrew/youtube-webos/pull/128): Updated workflows and dependencies (@throwaway96)
- [#133](https://github.com/webosbrew/youtube-webos/pull/133): Changed various dev stuff (@throwaway96)
- [#134](https://github.com/webosbrew/youtube-webos/pull/134): Refactored config/UI code (@throwaway96)
- [#138](https://github.com/webosbrew/youtube-webos/pull/138): Changed webpack to production mode by default (@throwaway96)
- [#145](https://github.com/webosbrew/youtube-webos/pull/145): Made observing attributes optional in waitForChildAdd() (@throwaway96)

## [0.3.2] - 2024/03/07

### Added

- [#100](https://github.com/webosbrew/youtube-webos/pull/100): Blocked "Sponsored" tiles (@alyyousuf7)

### Fixed

- [#95](https://github.com/webosbrew/youtube-webos/pull/95): Fixed the appearance of YouTube in the app (@0xBADEAFFE)
- [#96](https://github.com/webosbrew/youtube-webos/pull/96): Fixed launch functionality broken by #95 (@fire332)
- [#102](https://github.com/webosbrew/youtube-webos/pull/102): Fixed minor dev-related stuff (@alyyousuf7)
- [#106](https://github.com/webosbrew/youtube-webos/pull/106), [#120](https://github.com/webosbrew/youtube-webos/pull/120): Updated outdated documentation (@throwaway96)

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
