'use strict'
// Parses SDIO_GetDisplayStringList (0x9215) — the camera's own display strings.
// Layout: u32 headerSize, u32 payloadLen, u32 groupCount,
//         per group: u32 groupId, u16 valueWidthTag, u16 entryCount,
//                    entries of (value[width], u16 byteLen, utf8 bytes)
const WIDTH = { 2: 1, 4: 2, 6: 4 }

function parseDisplayStrings (b) {
  const groupCount = b.readUInt32LE(8)
  let o = 12
  const groups = {}
  for (let g = 0; g < groupCount && o + 8 <= b.length; g++) {
    const gid = b.readUInt32LE(o); o += 4
    const tag = b.readUInt16LE(o); o += 2
    const count = b.readUInt16LE(o); o += 2
    const w = WIDTH[tag] || 1
    const entries = {}
    for (let i = 0; i < count; i++) {
      if (o + w + 2 > b.length) break
      const val = b.readUIntLE(o, w); o += w
      const len = b.readUInt16LE(o); o += 2
      const nul = b.indexOf(0, o)
      entries[val] = b.subarray(o, nul >= 0 && nul < o + len ? nul : o + len).toString('utf8')
      o += len
    }
    groups[gid] = entries
  }
  return groups
}

// Group ids observed on the PXW-Z300 (fw 1.08)
const GROUP = {
  ASSIGNABLE_LONG: 10,   // 95 assignable-button functions, 52 = "Rec"
  ASSIGNABLE_SHORT: 11,
  UPLOAD_SERVER: 12,
  TRANSFER_STATUS: 14,
  SDR_HDR: 7,
  LOOK: 5,
  GAMUT: 6,
  LUT: 3,
  COLOUR_SPACE: 4,
  FILE_FORMAT: 16,       // 1 = MXF, 2 = MP4
  CODEC: 17,
  FRAME_RATE: 18,
  STREAM_PRESET: 23,
  BUTTON: 24,            // SET/MENU/multi-selector/thumbnail key codes
  SUBJECT_AF: 21
}

module.exports = { parseDisplayStrings, GROUP }
