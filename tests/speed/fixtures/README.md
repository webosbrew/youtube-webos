# Test fixtures

## DASH streams (`yt_*.bin`)

Real YouTube DASH segments for the TED talk
["Do schools kill creativity?"](https://www.youtube.com/watch?v=arj7oStGLkU) by
Ken Robinson (CC BY–NC–ND 4.0), fetched directly from YouTube's servers. Each
file is a byte-for-byte prefix of the original stream, cut down to the
smallest length the tests in `tests/speed/` actually need: an isobmff/webm
init segment plus, where a test needs real decodable media (sample or cluster
boundaries, fragment/cluster continuity), one or more full media segments.
Where nothing in the suite demuxes samples from a file, only the init segment
is kept.

| file         | itag | codec       | cut after                                         | original / cut size   |
| ------------ | ---- | ----------- | ------------------------------------------------- | --------------------- |
| `yt_136.bin` | 136  | H.264 video | the (only) `moof` box, no `mdat`                  | 400000 / 3756 bytes   |
| `yt_140.bin` | 140  | AAC audio   | 2 complete fragments + the header of a 3rd `moof` | 400000 / 327131 bytes |
| `yt_398.bin` | 398  | AV1 video   | the (only) `moof` box, no `mdat`                  | 400000 / 3396 bytes   |
| `yt_247.bin` | 247  | VP9 video   | the WebM `Tracks` element, no `Cluster`           | 400000 / 220 bytes    |
| `yt_251.bin` | 251  | Opus audio  | 2 complete `Cluster`s + 100 bytes into a 3rd      | 400000 / 306614 bytes |

`yt_140.bin` and `yt_251.bin` need real, complete media (not just headers)
because some tests check properties that only hold across real sample/cluster
boundaries: fragment-to-fragment timestamp continuity (`tfdt`), and that
demuxing a bare byte range gives the same frames as demuxing the whole file.
`yt_136.bin`/`yt_398.bin`/`yt_247.bin` are only ever used for init-segment
parsing and byte-forwarding checks, so no `mdat`/`Cluster` data is needed at
all.

Every top-level box/element (`mdat`, `Segment`, …) in these files already
declares a size larger than what's kept, so the parsers treat the tail as
"truncated" exactly like they do with a real, in-progress MSE append — cutting
the prefix shorter required no changes to box headers or sizes.

## `next-transport-controls.webos24.json`

The `transportControls` subtree of a real YouTube `/youtubei/v1/next`
response, captured on an LG OLED C4 (webOS 24) while watching the same video.
It drives the tests that check the "Speed" entry of the settings panel
(`speed-button.test.js`). All `trackingParams`/`clickTrackingParams` values
and `entityKey`/`key` tokens have been replaced with the constant placeholder
`"REDACTED"` (they're opaque, single-use analytics tokens; keeping the real
ones serves no test and they don't decode to anything meaningful). The signed-in
account's email address, which the raw response embeds twice as a UI label,
has been replaced with `user@example.com`. Structure, `type`s, `isDisabled`
flags, commands and visible text labels are otherwise untouched.
