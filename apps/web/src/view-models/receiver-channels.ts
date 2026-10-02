// Receiver tab helpers that are pure functions of parameter values and the
// live RC_CHANNELS stream: the RCMAP_* channel pickers, the CRSF fixed-range
// endpoints, and the transmitter-calibration check that runs on a CRSF link
// instead of the measured-endpoint capture.

import type { ParameterState } from '@arduconfig/ardupilot-core'

export const RC_CHANNEL_COUNT = 16

/** CH1..CH16 as select options for the four RCMAP_* pickers. */
export const RC_CHANNEL_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: RC_CHANNEL_COUNT },
  (_, index) => ({ value: index + 1, label: `CH${index + 1}` })
)

/**
 * RCMAP_* metadata carries a 1..16 range but no option list, so the raw
 * Parameters editor keeps its number input. The Receiver tab wants a channel
 * dropdown, so it hands ScopedSelectField a copy of the parameter whose
 * definition lists the channels. The copy never reaches the write path — a
 * draft is keyed by id and the runtime validates against its own metadata.
 */
export function withRcChannelOptions(parameter: ParameterState): ParameterState {
  const definition = parameter.definition
  return {
    ...parameter,
    definition: {
      id: parameter.id,
      label: definition?.label ?? parameter.id,
      description: definition?.description ?? '',
      category: definition?.category ?? 'radio',
      ...definition,
      options: RC_CHANNEL_OPTIONS
    }
  }
}

// --- CRSF ------------------------------------------------------------------

/**
 * What the flight controller makes of a CRSF frame. AP_RCProtocol_CRSF.cpp
 * decodes RC_CHANNELS_PACKED with decode_11bit_channels(…, 5, 8, 880):
 * µs = ticks * 5 / 8 + 880 in integer arithmetic, so the fixed CRSF range
 * 172..1811 ticks (centre 992) lands on 987..2011 µs, centre 1500. These are
 * the values ArduPilot sees, not TBS's nominal 988..2012, and they are what
 * RCn_MIN / RCn_MAX / RCn_TRIM should hold on a CRSF link.
 */
export const CRSF_RC_MIN_US = Math.floor((172 * 5) / 8) + 880 // 987
export const CRSF_RC_MAX_US = Math.floor((1811 * 5) / 8) + 880 // 2011
export const CRSF_RC_CENTER_US = Math.floor((992 * 5) / 8) + 880 // 1500

/** RC_PROTOCOLS bit index for CRSF (AP_RCProtocol: CRSF = 9 -> 1 << 9). */
export const RC_PROTOCOLS_CRSF_MASK = 1 << 9

export type RcLinkProtocol = 'crsf' | 'unknown'

/**
 * The vehicle does not stream which RC protocol decoded the last frame. Two
 * signals say "CRSF": an RC_PROTOCOLS allow-list that admits CRSF and nothing
 * else (the setup every ELRS / Crossfire guide recommends), or the boot
 * STATUSTEXT "RCInput: decoding CRSF" when the session was up to see it.
 * The default allow-list ("All") says nothing, so it stays 'unknown' and the
 * measured-endpoint flow runs exactly as before.
 */
export function detectRcLinkProtocol(input: {
  rcProtocolsMask: number | undefined
  statusTexts: readonly { text: string }[]
}): RcLinkProtocol {
  if (input.rcProtocolsMask !== undefined && Math.round(input.rcProtocolsMask) === RC_PROTOCOLS_CRSF_MASK) {
    return 'crsf'
  }
  if (input.statusTexts.some((entry) => /RCInput:\s*decoding\s+CRSF/i.test(entry.text))) {
    return 'crsf'
  }
  return 'unknown'
}

/**
 * Drafts for the CRSF fixed range on every channel whose endpoint parameters
 * the controller reports. Only parameters that exist are staged; a missing
 * RCn_TRIM (some builds trim only the stick axes) is skipped, not invented.
 */
export function buildCrsfEndpointDrafts(hasParameter: (paramId: string) => boolean): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (let channelNumber = 1; channelNumber <= RC_CHANNEL_COUNT; channelNumber += 1) {
    const entries: [string, number][] = [
      [`RC${channelNumber}_MIN`, CRSF_RC_MIN_US],
      [`RC${channelNumber}_MAX`, CRSF_RC_MAX_US],
      [`RC${channelNumber}_TRIM`, CRSF_RC_CENTER_US]
    ]
    for (const [paramId, value] of entries) {
      if (hasParameter(paramId)) {
        drafts[paramId] = String(value)
      }
    }
  }
  return drafts
}

/**
 * How far an observed extreme or centre may sit from the CRSF value before
 * the transmitter is called out of calibration. 20 µs is ArduPilot Copter's
 * default roll/pitch dead zone (ArduCopter/radio.cpp set_default_dead_zone):
 * a centre further off than that commands a drift the dead zone no longer
 * hides, and an endpoint that far short loses the same share of travel. A
 * calibrated EdgeTX/OpenTX radio hits the CRSF ends to the tick, so anything
 * past this is the radio, not noise.
 */
export const RC_CALIBRATION_TOLERANCE_US = 20

export interface TransmitterCalibrationInput {
  channelNumber: number
  observedMin: number | undefined
  observedMax: number | undefined
  /** Centre (trim) seen while the stick rested; undefined for throttle. */
  centerPwm: number | undefined
  /** True once the capture saw both ends (and the centre, where it applies). */
  complete: boolean
}

/**
 * How far a stick must have travelled, end to end, before its reach is
 * judged. The capture's own "both ends seen" rule cannot serve here: a stick
 * that stops short of the CRSF ends is exactly the one that never satisfies
 * it. 400 µs is 40% of the 1024 µs CRSF span — at least a fifth of the travel
 * each side of centre, which a half-moved stick does not do by accident and
 * a deliberately swept one always does.
 */
export const RC_CALIBRATION_SWEEP_MIN_US = 400

/**
 * The warning for a channel whose stick does not reach the CRSF range, or
 * rests off centre, judged once the stick has been swept both ways (or the
 * capture calls it complete) so a half-moved stick is not mistaken for a
 * short one. On CRSF the firmware values are not the fix — the radio's stick
 * calibration is — so the text says so.
 */
export function assessTransmitterCalibration(input: TransmitterCalibrationInput): string | undefined {
  if (input.observedMin === undefined || input.observedMax === undefined) {
    return undefined
  }
  const swept = input.observedMax - input.observedMin >= RC_CALIBRATION_SWEEP_MIN_US
  if (!input.complete && !swept) {
    return undefined
  }
  const minShort = input.observedMin > CRSF_RC_MIN_US + RC_CALIBRATION_TOLERANCE_US
  const maxShort = input.observedMax < CRSF_RC_MAX_US - RC_CALIBRATION_TOLERANCE_US
  const centreOff =
    input.centerPwm !== undefined && Math.abs(input.centerPwm - CRSF_RC_CENTER_US) > RC_CALIBRATION_TOLERANCE_US
  if (!minShort && !maxShort && !centreOff) {
    return undefined
  }
  const centre = input.centerPwm !== undefined ? `, centre ${Math.round(input.centerPwm)}` : ''
  return `Transmitter looks out of calibration on CH${input.channelNumber}: reached ${Math.round(input.observedMin)}..${Math.round(input.observedMax)}${centre}. Calibrate the sticks on the radio, not here.`
}
