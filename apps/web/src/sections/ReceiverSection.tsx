// ReceiverSection — App.tsx's `activeViewId === 'receiver'` block: the live
// monitor, the five task bodies (Mapping / Endpoints / Flight Modes /
// Functions / Signal Setup) and the one apply dock. Explanatory copy lives in
// each card's "i" dot; state (exercise status, guard reasons, verdicts,
// warnings) stays inline.
//
// The receiver hook results are passed as grouped props typed via
// `ReturnType<typeof useX>` so the prop shapes are INFERRED from the hooks
// and cannot drift. Scalar derivations, edit plumbing, and handler bodies
// stay in App.tsx and are threaded through here.

import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState, RcAxisId } from '@arduconfig/ardupilot-core'
import {
  deriveAirframe,
  deriveModeAssignments,
  deriveModeExerciseAssignments,
  deriveModeSwitchEstimate,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations,
  formatRcAxisLabel
} from '@arduconfig/ardupilot-core'
import { formatArducopterRssiType } from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { armSwitchChannelOptions, isArmSwitchHighlightActive, type ArmSwitchAssignment } from '../view-models/arm-switch'
import type { useModeSwitchDerivations } from '../hooks/use-mode-switch-derivations'
import type { useRcCalibrationDerivations } from '../hooks/use-rc-calibration-derivations'
import type { useRcExercises } from '../hooks/use-rc-exercises'
import type { useRcMappingDerivations } from '../hooks/use-rc-mapping-derivations'
import type { useRcRangeDerivations } from '../hooks/use-rc-range-derivations'
import type { useReceiverAdditional } from '../hooks/use-receiver-additional'
import type { useReceiverChannelDisplays } from '../hooks/use-receiver-channel-displays'
import type { useReceiverDetailToggles } from '../hooks/use-receiver-detail-toggles'
import type { useReceiverSupportCatalog } from '../hooks/use-receiver-support-catalog'
import type { useReceiverTasks } from '../hooks/use-receiver-tasks'
import type { useSerialPortModels } from '../hooks/use-serial-port-models'
import type { useSetupExercises } from '../hooks/use-setup-exercises'
import { formatParameterValue } from '../parameter-format'
import { formatModeAssignment } from '../modes-failsafe-helpers'
import { RcChannelBars } from '../rc-channel-bars'
import { selectParameterById } from '../selectors/parameter-read'
import { RC_DIRECTION_PROMPTS, type RcDirectionResult } from '../view-models/receiver-direction-check'
import {
  CRSF_RC_CENTER_US,
  CRSF_RC_MAX_US,
  CRSF_RC_MIN_US,
  assessTransmitterCalibration,
  buildCrsfEndpointDrafts,
  detectRcLinkProtocol,
  withRcChannelOptions
} from '../view-models/receiver-channels'
import { RC_CALIBRATION_AXIS_ORDER, RC_CALIBRATION_SWITCH_CHANNELS, rcCalibrationCaptureComplete } from '../setup-exercise-helpers'
import { StickCraftPreview } from '../preview-components'
import { formatRxRssi } from '../status-formatters'
import { toneForModeSwitchExercise } from '../tone-helpers'
import { InfoDot } from '../views/InfoDot'
import { ReceiverView } from '../views/Receiver'
import { ScopedBitmaskField, ScopedCheckboxField, ScopedField, ScopedSelectField } from '../views/ScopedField'

const RCMAP_PARAM_IDS: Record<RcAxisId, string> = {
  roll: 'RCMAP_ROLL',
  pitch: 'RCMAP_PITCH',
  throttle: 'RCMAP_THROTTLE',
  yaw: 'RCMAP_YAW'
}

export interface ReceiverSectionDerived {
  airframe: ReturnType<typeof deriveAirframe>
  rcAxisObservations: ReturnType<typeof deriveRcAxisObservations>
  currentRcAxisChannelMap: ReturnType<typeof deriveRcAxisChannelMap>
  modeSwitchEstimate: ReturnType<typeof deriveModeSwitchEstimate>
  modeExerciseAssignments: ReturnType<typeof deriveModeExerciseAssignments>
  modeAssignments: ReturnType<typeof deriveModeAssignments>
  modeSwitchExercise: ReturnType<typeof useSetupExercises>['modeSwitchExercise']
  recentModeSwitchChange: boolean | undefined
  configuredModeChannel: number | undefined
  rssiType: number | undefined
  rssiChannel: number | undefined
  rssiChannelLow: number | undefined
  rssiChannelHigh: number | undefined
  modeAssignmentParameters: readonly ParameterState[]
  receiverLinkPorts: ReturnType<typeof useSerialPortModels>['receiverLinkPorts']
  receiverDraftEntries: readonly ParameterDraftEntry[]
  receiverStagedDrafts: readonly ParameterDraftEntry[]
  receiverInvalidDrafts: readonly ParameterDraftEntry[]
  canRunRcMappingExercise: boolean
  canRunRcRangeExercise: boolean
  canCaptureRcCalibration: boolean
  canRunModeSwitchExercise: boolean
  receiverWorkflowDraftCount: number
  receiverWorkflowInvalidCount: number
  receiverAdvancedDraftCount: number
  receiverAdvancedInvalidCount: number
  receiverHasPendingReview: boolean
  /** True once RC5_OPTION metadata is synced — proves this firmware exposes
   *  RCn_OPTION at all, so the Arm switch card has something to bind to. */
  armSwitchAvailable: boolean
  armSwitchAssignment: ArmSwitchAssignment
  /** RC Mixer (AP_RC_Logic) function labels per channel, so aux-channel cards
   *  and the arm-switch card can warn that a channel already carries an RCL
   *  term (the reverse of the RC Mixer's own "also used by" badge). */
  rcLogicChannelClaims?: ReadonlyMap<number, readonly string[]>
}

export interface ReceiverSectionHandlers {
  handleStartRcMappingExercise: () => void
  handleConfirmRcMappingCandidate: () => void
  handleStageRcMappingDrafts: () => void
  handleResetRcMappingExercise: () => void
  handleFailRcMappingExercise: () => void
  handleStartRcRangeExercise: () => void
  handleResetRcRangeExercise: () => void
  handleFailRcRangeExercise: () => void
  handleStartRcCalibrationCapture: () => void
  handleResetRcCalibrationCapture: () => void
  handleStageRcCalibrationDrafts: () => void
  handleStartModeSwitchExercise: () => void
  handleCompleteModeSwitchExercise: () => void
  handleResetModeSwitchExercise: () => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  renderAdditionalSettingsCard: (
    title: string,
    description: string,
    groups: import('../view-models/peripherals').AdditionalSettingsGroup[],
    drafts: ParameterDraftEntry[],
    staged: ParameterDraftEntry[],
    invalid: ParameterDraftEntry[],
    applyActionId: string,
    applyLabel: string,
    discardScope: string
  ) => ReactNode
  setDraft: (paramId: string, value: string) => void
  /** Stage several drafts at once (the CRSF endpoint set). Same pool as setDraft. */
  mergeDrafts: (drafts: Record<string, string>) => void
  setReceiverTaskOverride: (taskId: import('../views/Receiver').ReceiverTaskId) => void
  handleSetArmSwitchChannel: (channel: number, airmode: boolean) => void
}

export interface ReceiverSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  /** Send MAV_CMD_START_RX_PAIR to bind the RC receiver (ELRS/CRSF). */
  onBindReceiver: () => void
  /** Latched per-axis channel-direction verdicts (computed in App so the
   *  Endpoints card and the guided-setup radio gate share one result). */
  rcDirectionResults: Record<RcAxisId, RcDirectionResult>
  /** The axis whose stick is deflected right now — highlights its row + is what
   *  the reacting example craft is showing. Momentary, not latched. */
  rcDirectionActiveAxis: RcAxisId | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  rcExercises: ReturnType<typeof useRcExercises>
  receiverChannelDisplays: ReturnType<typeof useReceiverChannelDisplays>
  rcMappingDerivations: ReturnType<typeof useRcMappingDerivations>
  rcRangeDerivations: ReturnType<typeof useRcRangeDerivations>
  modeSwitchDerivations: ReturnType<typeof useModeSwitchDerivations>
  rcCalibrationDerivations: ReturnType<typeof useRcCalibrationDerivations>
  receiverTasks: ReturnType<typeof useReceiverTasks>
  receiverSupportCatalog: ReturnType<typeof useReceiverSupportCatalog>
  receiverAdditional: ReturnType<typeof useReceiverAdditional>
  receiverDetailToggles: ReturnType<typeof useReceiverDetailToggles>
  derived: ReceiverSectionDerived
  handlers: ReceiverSectionHandlers
}

function pwmPercent(value: number): number {
  return Math.max(0, Math.min(100, ((value - 1000) / 1000) * 100))
}

export function ReceiverSection(props: ReceiverSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    onBindReceiver,
    rcDirectionResults,
    rcDirectionActiveAxis,
    editedValues,
    parameterDraftById,
    rcExercises,
    receiverChannelDisplays,
    rcMappingDerivations,
    rcCalibrationDerivations,
    receiverTasks,
    receiverSupportCatalog,
    receiverAdditional,
    receiverDetailToggles,
    derived,
    handlers
  } = props

  // Bind button hidden for now (the runtime capability + onBindReceiver wiring
  // stay intact, so flip this to re-surface it). See the receiver-bind-action
  // block below.
  const SHOW_RECEIVER_BIND_BUTTON: boolean = false

  // Brief visual confirmation that the bind command was sent — the action is
  // fire-and-forget, so the button flips to the accent colour (and "Bind sent")
  // for ~1.6s on click, then reverts.
  const [bindFlash, setBindFlash] = useState(false)
  useEffect(() => {
    if (!bindFlash) {
      return
    }
    const timer = setTimeout(() => setBindFlash(false), 1600)
    return () => clearTimeout(timer)
  }, [bindFlash])

  const { rcMappingSession, rcCalibrationSession } = rcExercises

  const { receiverPrimaryChannelDisplays, receiverAuxChannelDisplays } = receiverChannelDisplays

  const {
    rcMappingCandidate,
    rcMappingLiveCandidates,
    rcMappingCapturedCount,
    rcMappingTargetGuide,
    rcMappingCandidateConfidence,
    rcMappingRejectedReason,
    rcMappingStagedChangeCount,
    rcMappingAutoCaptureKey,
    rcMappingAutoCaptureProgressPercent
  } = rcMappingDerivations

  const { rcCalibrationSummary } = rcCalibrationDerivations

  const { activeReceiverTaskId, receiverTaskCards, activeReceiverTask } = receiverTasks

  const {
    modeChannelParameter,
    rssiTypeParameter,
    rssiChannelParameter,
    rssiChannelLowParameter,
    rssiChannelHighParameter,
    rcOptionsParameter,
    receiverSupportParameterById,
    rcFunctionRows,
    rcFunctionAssigned,
    rcFunctionConflicts
  } = receiverSupportCatalog

  const {
    receiverAdditionalGroups,
    receiverAdditionalDraftEntries,
    receiverAdditionalStagedDrafts,
    receiverAdditionalInvalidDrafts
  } = receiverAdditional

  const {
    showReceiverChannelDetails,
    setShowReceiverChannelDetails,
    showReceiverMappingDiagnostics,
    setShowReceiverMappingDiagnostics
  } = receiverDetailToggles

  const {
    airframe,
    rcAxisObservations,
    currentRcAxisChannelMap,
    modeSwitchEstimate,
    modeExerciseAssignments,
    recentModeSwitchChange,
    configuredModeChannel,
    rssiType,
    rssiChannel,
    rssiChannelLow,
    rssiChannelHigh,
    modeAssignmentParameters,
    receiverLinkPorts,
    receiverDraftEntries,
    receiverStagedDrafts,
    receiverInvalidDrafts,
    canRunRcMappingExercise,
    canCaptureRcCalibration,
    receiverHasPendingReview,
    armSwitchAvailable,
    armSwitchAssignment,
    rcLogicChannelClaims
  } = derived

  const {
    handleStartRcMappingExercise,
    handleConfirmRcMappingCandidate,
    handleStageRcMappingDrafts,
    handleResetRcMappingExercise,
    handleFailRcMappingExercise,
    handleStartRcCalibrationCapture,
    handleResetRcCalibrationCapture,
    handleStageRcCalibrationDrafts,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts,
    renderAdditionalSettingsCard,
    setDraft,
    mergeDrafts,
    setReceiverTaskOverride,
    handleSetArmSwitchChannel
  } = handlers

  // Arm-switch red box: the live PWM on the assigned arm-switch channel (0xffff
  // = the RC_CHANNELS no-data sentinel), and whether the vehicle is armed via
  // that switch (armed + channel in the arm/high position).
  const armSwitchChannelPwm =
    armSwitchAssignment.channel !== undefined
      ? snapshot.liveVerification.rcInput.channels[armSwitchAssignment.channel - 1]
      : undefined
  const armSwitchHighlightActive = isArmSwitchHighlightActive(
    armSwitchAssignment,
    Boolean(snapshot.vehicle?.armed),
    armSwitchChannelPwm === undefined || armSwitchChannelPwm === 0xffff ? undefined : armSwitchChannelPwm
  )

  // The four RCMAP_* pickers: a channel dropdown over the live parameter.
  const rcmapParameters = useMemo(
    () =>
      Object.fromEntries(
        RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
          const parameter = selectParameterById(snapshot, RCMAP_PARAM_IDS[axisId])
          return [axisId, parameter ? withRcChannelOptions(parameter) : undefined]
        })
      ) as Record<RcAxisId, ParameterState | undefined>,
    [snapshot]
  )
  // The channel an axis is mapped to as the operator sees it: a staged RCMAP
  // pick wins over the live map, so the reverse box beside it follows the pick.
  const mappedChannel = (axisId: RcAxisId): number => {
    const edited = editedValues[RCMAP_PARAM_IDS[axisId]]
    const editedNumber = edited !== undefined ? Number(edited) : NaN
    return Number.isInteger(editedNumber) && editedNumber >= 1 && editedNumber <= 16
      ? editedNumber
      : currentRcAxisChannelMap[axisId]
  }

  const rcLinkProtocol = detectRcLinkProtocol({
    rcProtocolsMask: selectParameterById(snapshot, 'RC_PROTOCOLS')?.value,
    statusTexts: snapshot.statusTexts
  })
  const crsfLink = rcLinkProtocol === 'crsf'

  // One apply bar for the whole tab: workflow drafts (mapping, endpoints,
  // modes, functions, RSSI) and the Signal Setup extras. The two scopes are
  // disjoint, so the concatenation has no duplicates.
  const allReceiverDrafts = useMemo(
    () =>
      [...receiverDraftEntries, ...receiverAdditionalDraftEntries].filter(
        // An edit that matches the live value is nothing to apply or list.
        (entry) => entry.status !== 'unchanged'
      ),
    [receiverAdditionalDraftEntries, receiverDraftEntries]
  )
  const allStagedCount = receiverStagedDrafts.length + receiverAdditionalStagedDrafts.length
  const allInvalidCount = receiverInvalidDrafts.length + receiverAdditionalInvalidDrafts.length

  const renderReverseField = (channelNumber: number, testId: string): ReactNode => {
    const parameter = selectParameterById(snapshot, `RC${channelNumber}_REVERSED`)
    if (!parameter) {
      return null
    }
    return (
      <ScopedCheckboxField
        parameter={parameter}
        liveValue={parameter.value}
        editedValues={editedValues}
        onChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        testId={testId}
        caption="Reverse"
        showTitle={false}
      />
    )
  }

  const mappingStatusLabel =
    rcMappingSession.status === 'ready'
      ? 'complete'
      : rcMappingSession.status === 'running'
        ? `step ${Math.min(rcMappingCapturedCount + 1, RC_CALIBRATION_AXIS_ORDER.length)} of ${RC_CALIBRATION_AXIS_ORDER.length}`
        : rcMappingSession.status
  const mappingTone = toneForModeSwitchExercise(
    rcMappingSession.status === 'ready' ? 'passed' : rcMappingSession.status === 'running' ? 'running' : rcMappingSession.status === 'failed' ? 'failed' : 'idle'
  )
  const calibrationTone = toneForModeSwitchExercise(
    rcCalibrationSession.status === 'ready' ? 'passed' : rcCalibrationSession.status === 'capturing' ? 'running' : rcCalibrationSession.status === 'failed' ? 'failed' : 'idle'
  )

  return (
        <ReceiverView
          taskCards={receiverTaskCards}
          activeTaskId={activeReceiverTaskId}
          activeTask={activeReceiverTask}
          onSelectTask={setReceiverTaskOverride}
          liveMonitorSlot={
                <div className="receiver-monitor__sticky">
                  {/* Betaflight-style side-by-side: live RC channels on one
                   *  side, the reactive craft model on the other. Stacks back to
                   *  a single column on narrow/phone widths. */}
                  <div className="receiver-live-columns">
                    <div className="receiver-live-columns__channels">
                  <RcChannelBars
                    channels={receiverPrimaryChannelDisplays}
                    verified={snapshot.liveVerification.rcInput.verified}
                    testId="receiver-channel-bars"
                    armSwitchChannel={armSwitchAssignment.channel}
                    armSwitchActive={armSwitchHighlightActive}
                  />

                    </div>

                    {/* The bare mini deck, not the full flight deck shrunk: a
                        small reacting craft beside the bars is all this surface
                        is for. Same stick/reversal maths as the Endpoints check.
                        The mode readout and the RC Mixer note sit under it, in
                        the height the bars already take. */}
                    <div className="receiver-live-columns__craft">
                      <div className="receiver-live-head">
                        <h3>Live monitor</h3>
                        <StatusBadge tone={snapshot.liveVerification.rcInput.verified ? 'success' : 'warning'}>
                          {snapshot.liveVerification.rcInput.verified ? `${snapshot.liveVerification.rcInput.channelCount} channels live` : 'No RC telemetry'}
                        </StatusBadge>
                      </div>
                      <div className="receiver-stick-craft" data-testid="receiver-stick-craft-card">
                        <StickCraftPreview
                          observations={rcAxisObservations}
                          snapshot={snapshot}
                          verified={snapshot.liveVerification.rcInput.verified}
                          vehicleType={snapshot.vehicle?.vehicle}
                          frameClassLabel={airframe.frameClassLabel}
                          frameTypeLabel={airframe.frameTypeLabel}
                          mini
                        />
                      </div>

                  <div
                    className={`receiver-flight-mode-line${recentModeSwitchChange ? ' is-attention' : ''}`}
                    data-testid="receiver-flight-mode-line"
                  >
                    <strong>Flight mode</strong>
                    <span className="receiver-flight-mode-line__ch">
                      {modeSwitchEstimate.channelNumber !== undefined ? `CH${modeSwitchEstimate.channelNumber}` : 'Unset'}
                    </span>
                    <span className="receiver-flight-mode-line__state">
                      {modeSwitchEstimate.channelNumber === undefined
                        ? 'Mode channel not configured yet.'
                        : modeSwitchEstimate.estimatedSlot !== undefined
                          ? `Slot ${modeSwitchEstimate.estimatedSlot} · ${formatModeAssignment(modeSwitchEstimate.configuredValue, snapshot.vehicle?.vehicle)}`
                          : 'Waiting for the configured mode channel to move.'}
                    </span>
                    <span className="receiver-flight-mode-line__pwm">
                      {modeSwitchEstimate.pwm !== undefined ? `${modeSwitchEstimate.pwm} µs` : 'No data'}
                      {recentModeSwitchChange ? ' · moved' : ''}
                    </span>
                  </div>

                  {rcLogicChannelClaims && rcLogicChannelClaims.size > 0 ? (
                    <p className="receiver-rcl-summary" data-testid="receiver-rcl-summary">
                      ⚠ RC Mixer terms also drive:{' '}
                      {[...rcLogicChannelClaims.entries()]
                        .sort(([left], [right]) => left - right)
                        .map(([channel, labels]) => `CH${channel} (${labels.join(', ')})`)
                        .join(', ')}
                      . These channels carry both their normal input and an RC Mixer function.
                    </p>
                  ) : null}
                    </div>
                  </div>

                  {/* Channels that are neither mapped nor streaming nor assigned.
                      Nothing to show means no button either. */}
                  {receiverAuxChannelDisplays.length > 0 ? (
                  <div className="receiver-channel-disclosure">
                    <button
                      style={buttonStyle()}
                      onClick={() => setShowReceiverChannelDetails((existing) => !existing)}
                    >
                      {showReceiverChannelDetails ? 'Hide AUX Channels' : `Show AUX Channels (${receiverAuxChannelDisplays.length})`}
                    </button>
                  </div>
                  ) : null}

                  {showReceiverChannelDetails && receiverAuxChannelDisplays.length > 0 ? (
                      <div className="rc-channel-grid rc-channel-grid--secondary">
                        {receiverAuxChannelDisplays.map((channel) => (
                          <article
                            key={channel.channelNumber}
                            className={`rc-channel-card${channel.isModeChannel ? ' rc-channel-card--mode' : ''}${channel.isModeChannel && recentModeSwitchChange ? ' rc-channel-card--active' : ''}`}
                          >
                            <div className="rc-channel-card__header">
                              <strong>CH{channel.channelNumber}</strong>
                              <span>{channel.role}</span>
                            </div>
                            <div className="rc-bar" aria-hidden="true">
                              <div className="rc-bar__trim" style={{ left: `${channel.trimPercent}%` }} />
                              <div className="rc-bar__fill" style={{ width: `${channel.fillPercent}%` }} />
                            </div>
                            <div className="rc-channel-card__footer">
                              <span>{channel.pwm !== undefined ? `${channel.pwm} µs` : 'No data'}</span>
                              <span>{channel.isModeChannel ? 'Mode channel' : 'Aux input'}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                  ) : null}

                  {SHOW_RECEIVER_BIND_BUTTON ? (
                  <div className="receiver-bind-action" data-testid="receiver-bind-action">
                    <button
                      type="button"
                      data-testid="receiver-bind-button"
                      style={{
                        ...buttonStyle(),
                        ...(bindFlash
                          ? { background: 'var(--accent, #ffbb00)', borderColor: 'var(--accent, #ffbb00)', color: '#10151c' }
                          : {})
                      }}
                      disabled={snapshot.connection.kind !== 'connected' || busyAction !== undefined}
                      onClick={() => {
                        onBindReceiver()
                        setBindFlash(true)
                      }}
                    >
                      {bindFlash ? 'Bind sent ✓' : 'Bind RX (ELRS / CRSF)'}
                    </button>
                    {/* The shared InfoDot rather than a hand-rolled copy of its
                        markup: the copy could not carry the wiki link, and being
                        aria-hidden it hid the only explanation of what Bind does
                        from screen-reader users entirely. */}
                    <InfoDot label="About binding an ELRS / CRSF receiver" testId="receiver-bind-info" wikiTopic="receiverBind">
                      Tells ArduPilot to send the bind command to the receiver (MAV_CMD_START_RX_PAIR).
                      Put your transmitter / ELRS module into bind mode too; the receiver LED confirms pairing.
                      ELRS receivers with a bind phrase set ignore this — bind by phrase or power-cycle instead.
                    </InfoDot>
                  </div>
                  ) : null}
                </div>
          }
          taskBodySlot={
            <>
                {activeReceiverTaskId === 'mapping' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    <div className="rc-mapping-card" data-testid="receiver-mapping-card">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Channel mapping</strong>
                          <InfoDot label="About channel mapping" wide>
                            Which receiver channel carries roll, pitch, throttle and yaw (RCMAP_*). Pick each channel
                            here, or run the guided capture: move one stick at a time, the app locks onto the channel
                            that moves alone and stages the detected map. Tick Reverse on a channel the flight
                            controller reads backwards; the Endpoints tab checks that for you. RCMAP changes take
                            effect after a reboot.
                          </InfoDot>
                        </div>
                        <StatusBadge tone={mappingTone}>{mappingStatusLabel}</StatusBadge>
                      </div>

                      {rcMappingSession.status === 'running' ? (
                        <div className="rc-mapping-focus rc-mapping-focus--active" data-testid="receiver-mapping-focus">
                          <div className="rc-mapping-focus__copy">
                            <strong>{rcMappingTargetGuide.title}</strong>
                            <p>{rcMappingTargetGuide.detail}</p>
                          </div>
                          <div className="rc-mapping-focus__status">
                            <StatusBadge tone={rcMappingCandidateConfidence.tone}>
                              {`${rcMappingCandidateConfidence.label} detection`}
                            </StatusBadge>
                          </div>
                        </div>
                      ) : null}

                      {rcMappingSession.status === 'ready' ? (
                        <div className="rc-mapping-focus rc-mapping-focus--complete" data-testid="receiver-mapping-focus">
                          <div className="rc-mapping-focus__copy">
                            <strong>Roll, pitch, throttle and yaw identified.</strong>
                            <p>
                              {rcMappingStagedChangeCount > 0
                                ? `${rcMappingStagedChangeCount} RCMAP change${rcMappingStagedChangeCount === 1 ? '' : 's'} staged. Apply below, then reboot.`
                                : 'The current map already matches the sticks.'}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {rcMappingSession.status === 'failed' && rcMappingSession.failureReason ? (
                        <p className="switch-exercise-warning">{rcMappingSession.failureReason}</p>
                      ) : null}

                      <div className="receiver-map-grid" data-testid="receiver-map-grid">
                        {RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
                          const capture = rcMappingSession.captures[axisId]
                          const activeTarget = rcMappingSession.status === 'running' && rcMappingSession.currentTargetAxis === axisId
                          const detected = capture.detectedChannelNumber
                          const rcmap = rcmapParameters[axisId]
                          const channel = mappedChannel(axisId)
                          const detail = activeTarget
                            ? rcMappingCandidate
                              ? `Locking onto CH${rcMappingCandidate.channelNumber}`
                              : 'Move this stick only'
                            : detected !== undefined
                              ? `Detected CH${detected}`
                              : rcMappingSession.status === 'running'
                                ? 'Pending'
                                : ''
                          return (
                            <div
                              key={axisId}
                              className={`receiver-map-row${activeTarget ? ' receiver-map-row--target' : ''}${detected !== undefined ? ' receiver-map-row--complete' : ''}`}
                              data-testid={`receiver-map-${axisId}`}
                            >
                              <span className="receiver-map-row__axis">
                                <strong>{formatRcAxisLabel(axisId)}</strong>
                                {detail ? <small>{detail}</small> : null}
                              </span>
                              {rcmap ? (
                                <ScopedSelectField
                                  parameter={rcmap}
                                  liveValue={currentRcAxisChannelMap[axisId]}
                                  editedValues={editedValues}
                                  onChange={(paramId, value) => setDraft(paramId, value)}
                                  draftStatusById={parameterDraftById}
                                />
                              ) : (
                                <span className="receiver-map-row__fixed">CH{channel}</span>
                              )}
                              {renderReverseField(channel, `receiver-reverse-${channel}`)}
                            </div>
                          )
                        })}
                      </div>

                      {rcMappingCandidate ? (
                        <div key={rcMappingAutoCaptureKey} className="rc-mapping-auto-capture">
                          <div className="rc-mapping-auto-capture__copy">
                            <strong>Locking onto CH{rcMappingCandidate.channelNumber}</strong>
                            <small>Keep moving it; the channel captures on its own.</small>
                          </div>
                          <div className="rc-mapping-auto-capture__meter" aria-hidden="true">
                            <span
                              className="rc-mapping-auto-capture__fill"
                              style={{ width: `${rcMappingAutoCaptureProgressPercent}%` }}
                            />
                          </div>
                        </div>
                      ) : null}

                      {!rcMappingCandidate && rcMappingRejectedReason ? (
                        <p className="switch-exercise-warning">{rcMappingRejectedReason}</p>
                      ) : null}

                      {rcMappingSession.status === 'running' && showReceiverMappingDiagnostics ? (
                        <div className="rc-mapping-candidate-panel">
                          <div className="rc-mapping-candidate-panel__header">
                            <strong>Live candidates</strong>
                            <small>Channel movement against the baseline captured when the exercise started.</small>
                          </div>
                          {rcMappingLiveCandidates.length > 0 ? (
                            <div className="rc-mapping-candidate-list">
                              {rcMappingLiveCandidates.map((candidate, index) => (
                                <article
                                  key={`${rcMappingSession.currentTargetAxis}:${candidate.channelNumber}`}
                                  className={`rc-mapping-candidate${index === 0 ? ' is-leading' : ''}`}
                                >
                                  <div className="rc-mapping-candidate__header">
                                    <strong>CH{candidate.channelNumber}</strong>
                                    <StatusBadge tone={index === 0 ? rcMappingCandidateConfidence.tone : 'neutral'}>
                                      {index === 0 ? 'leading' : 'candidate'}
                                    </StatusBadge>
                                  </div>
                                  <p>{Math.round(candidate.deltaUs)} µs change</p>
                                  <small>
                                    {Math.round(candidate.baselinePwm)} µs baseline to {Math.round(candidate.livePwm)} µs live
                                  </small>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="switch-exercise-warning">No channel is standing out yet. Move only the highlighted control and keep the others still.</p>
                          )}
                        </div>
                      ) : null}

                      <div className="switch-exercise-controls">
                        {rcMappingSession.status !== 'running' ? (
                          <button
                            style={buttonStyle('primary')}
                            data-testid="receiver-mapping-start"
                            onClick={handleStartRcMappingExercise}
                            disabled={!canRunRcMappingExercise}
                          >
                            {rcMappingSession.status === 'ready' ? 'Run Guided Mapping Again' : 'Begin Guided Mapping'}
                          </button>
                        ) : null}
                        {rcMappingSession.status === 'running' ? (
                          <button
                            style={buttonStyle('secondary')}
                            onClick={handleConfirmRcMappingCandidate}
                            disabled={rcMappingCandidate === undefined}
                          >
                            {rcMappingCandidate && rcMappingSession.currentTargetAxis
                              ? `Capture CH${rcMappingCandidate.channelNumber} for ${formatRcAxisLabel(rcMappingSession.currentTargetAxis)}`
                              : 'Capture Current Channel'}
                          </button>
                        ) : null}
                        {rcMappingSession.status === 'running' ? (
                          <button
                            style={buttonStyle()}
                            onClick={() => setShowReceiverMappingDiagnostics((existing) => !existing)}
                          >
                            {showReceiverMappingDiagnostics ? 'Hide Detection Details' : 'Show Detection Details'}
                          </button>
                        ) : null}
                        {rcMappingSession.status === 'ready' && rcMappingStagedChangeCount > 0 ? (
                          <button
                            style={buttonStyle('secondary')}
                            data-testid="receiver-mapping-stage"
                            onClick={handleStageRcMappingDrafts}
                          >
                            {`Stage Detected Mapping (${rcMappingStagedChangeCount})`}
                          </button>
                        ) : null}
                        {rcMappingSession.status === 'ready' ? (
                          <button
                            style={buttonStyle('primary')}
                            data-testid="receiver-mapping-continue-endpoints"
                            onClick={() => setReceiverTaskOverride('endpoints')}
                          >
                            Continue to Endpoints
                          </button>
                        ) : null}
                        {rcMappingSession.status !== 'idle' ? (
                          <button style={buttonStyle()} onClick={handleResetRcMappingExercise}>
                            Start Over
                          </button>
                        ) : null}
                        {rcMappingSession.status === 'running' ? (
                          <button style={buttonStyle('secondary')} onClick={handleFailRcMappingExercise}>
                            Can’t Isolate Axis
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeReceiverTaskId === 'endpoints' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack receiver-tab-body receiver-tab-body--endpoints">
                    <div className="rc-direction-card" data-testid="receiver-direction-check">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Channel direction</strong>
                          <InfoDot label="About the channel direction check" wide>
                            Move each stick the way it is labelled; the example craft reacts so you can confirm each
                            axis at a glance. An axis the flight controller reads backwards is flagged with a one-click
                            reverse, staged like every other Receiver edit.
                          </InfoDot>
                        </div>
                      </div>
                      <div className="rc-direction-body">
                        <div className="rc-direction-craft" data-testid="receiver-direction-craft">
                          <StickCraftPreview
                            observations={rcAxisObservations}
                            snapshot={snapshot}
                            verified={snapshot.liveVerification.rcInput.verified}
                            vehicleType={snapshot.vehicle?.vehicle}
                            frameClassLabel={airframe.frameClassLabel}
                            frameTypeLabel={airframe.frameTypeLabel}
                            mini
                          />
                        </div>
                        <div className="rc-direction-grid">
                        {rcAxisObservations.map((observation) => {
                          const reversedParam = selectParameterById(snapshot, `RC${observation.channelNumber}_REVERSED`)
                          if (!reversedParam) {
                            return null
                          }
                          const result = rcDirectionResults[observation.axisId]
                          const liveReversed = (reversedParam.value ?? 0) !== 0
                          const staged = editedValues[reversedParam.id] !== undefined
                          const active = rcDirectionActiveAxis === observation.axisId
                          return (
                            <div
                              key={observation.axisId}
                              className={`rc-direction-row rc-direction-row--${result}${active ? ' rc-direction-row--active' : ''}`}
                              data-testid={`receiver-direction-${observation.axisId}`}
                            >
                              <span className="rc-direction-row__axis">{observation.label}</span>
                              <span className="rc-direction-row__prompt">{RC_DIRECTION_PROMPTS[observation.axisId].movement}</span>
                              <span
                                className="rc-direction-row__verdict"
                                data-testid={`receiver-direction-result-${observation.axisId}`}
                              >
                                {result === 'correct' ? '✓ correct' : result === 'reversed' ? '⚠ backwards' : '— move to test'}
                              </span>
                              {result === 'reversed' ? (
                                <button
                                  type="button"
                                  className="rc-direction-row__reverse"
                                  data-testid={`receiver-direction-reverse-${observation.axisId}`}
                                  style={buttonStyle()}
                                  disabled={staged}
                                  onClick={() => setDraft(reversedParam.id, liveReversed ? '0' : '1')}
                                >
                                  {staged ? 'Reverse staged' : `Reverse ${observation.label}`}
                                </button>
                              ) : null}
                            </div>
                          )
                        })}
                        </div>
                      </div>
                    </div>

                    <div className="rc-calibration-card" data-testid="receiver-endpoints-card">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Endpoints</strong>
                            <InfoDot label="About RC endpoints" wide>
                              {crsfLink
                                ? `A CRSF link carries a fixed channel range: the flight controller reads ${CRSF_RC_MIN_US} to ${CRSF_RC_MAX_US} µs with the centre at ${CRSF_RC_CENTER_US}, so the endpoints are set from those values rather than measured. Checking the sticks still shows whether the radio itself reaches that range; a short or off-centre stick is fixed by calibrating the radio, not by changing these values.`
                                : 'Start the capture with the sticks centred and throttle low, move roll, pitch, throttle and yaw through their full travel, and flick the CH5/CH6 switches low and high if you use them. Stage the captured values, then apply them from this tab.'}
                            </InfoDot>
                          </div>
                          <StatusBadge tone={calibrationTone}>
                            {rcCalibrationSession.status === 'ready' ? 'complete' : rcCalibrationSession.status}
                          </StatusBadge>
                        </div>

                        {crsfLink ? (
                          <p className="receiver-endpoints-line" data-testid="receiver-endpoints-crsf">
                            CRSF link: fixed range {CRSF_RC_MIN_US} to {CRSF_RC_MAX_US} µs, centre {CRSF_RC_CENTER_US}.
                          </p>
                        ) : rcCalibrationSession.status !== 'idle' ? (
                          <p className="receiver-endpoints-line">{rcCalibrationSummary}</p>
                        ) : null}

                        <div className="rc-range-axis-grid">
                          {RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
                            const capture = rcCalibrationSession.captures[axisId]
                            const observation = rcAxisObservations.find((obs) => obs.axisId === axisId)
                            const livePwm = observation?.pwm
                            const channelNumber = capture.channelNumber || observation?.channelNumber || currentRcAxisChannelMap[axisId]
                            const complete = rcCalibrationCaptureComplete(capture)
                            const calibrationWarning = crsfLink
                              ? assessTransmitterCalibration({
                                  channelNumber,
                                  observedMin: capture.observedMin,
                                  observedMax: capture.observedMax,
                                  centerPwm: axisId === 'throttle' ? undefined : capture.trimPwm,
                                  complete
                                })
                              : undefined
                            return (
                              <article
                                key={axisId}
                                className={`rc-range-axis-card${complete ? ' rc-range-axis-card--complete' : ''}`}
                                data-testid={`receiver-endpoint-${axisId}`}
                              >
                                <div className="rc-range-axis-card__header">
                                  <strong>{capture.label}</strong>
                                  <span>CH{channelNumber}</span>
                                </div>
                                <p>{livePwm !== undefined ? `${livePwm} µs live` : 'No live data'}</p>
                                {/* Live channel-movement bar: the swept band lights the ends
                                    already reached and the marker tracks the stick. */}
                                <div className="rc-range-axis-card__bar" data-testid={`rc-range-bar-${axisId}`} aria-hidden="true">
                                  {capture.lowObserved ? <div className="rc-range-axis-card__swept" style={{ left: '0%', width: '20%' }} /> : null}
                                  {capture.highObserved ? <div className="rc-range-axis-card__swept" style={{ left: '80%', width: '20%' }} /> : null}
                                  {livePwm !== undefined ? <div className="rc-range-axis-card__marker" style={{ left: `${pwmPercent(livePwm)}%` }} /> : null}
                                </div>
                                <p>
                                  Min {capture.observedMin !== undefined ? Math.round(capture.observedMin) : 'Unknown'} µs · Max{' '}
                                  {capture.observedMax !== undefined ? Math.round(capture.observedMax) : 'Unknown'} µs
                                </p>
                                <div className="config-pills">
                                  <span className={capture.lowObserved ? 'is-complete' : undefined}>Low</span>
                                  <span className={capture.highObserved ? 'is-complete' : undefined}>High</span>
                                  {axisId !== 'throttle' ? (
                                    <span className={capture.centeredObserved ? 'is-complete' : undefined}>
                                      Trim {capture.trimPwm !== undefined ? Math.round(capture.trimPwm) : 'pending'}
                                    </span>
                                  ) : null}
                                </div>
                                {calibrationWarning ? (
                                  <p
                                    className="switch-exercise-warning"
                                    data-testid={`receiver-endpoints-calibration-warning-${axisId}`}
                                  >
                                    ⚠ {calibrationWarning}
                                  </p>
                                ) : null}
                              </article>
                            )
                          })}
                          {/* CH5/CH6 switch channels — optional add-on. Flick each
                              switch low + high to capture its RCn_MIN/MAX endpoints. */}
                          {RC_CALIBRATION_SWITCH_CHANNELS.map((channelNumber) => {
                            const capture = rcCalibrationSession.switchCaptures[channelNumber]
                            if (!capture) {
                              return null
                            }
                            const livePwm = snapshot.liveVerification.rcInput.channels[channelNumber - 1]
                            const hasLive = typeof livePwm === 'number' && livePwm !== 0xffff
                            const complete = capture.lowObserved && capture.highObserved
                            return (
                              <article
                                key={`switch-${channelNumber}`}
                                className={`rc-range-axis-card${complete ? ' rc-range-axis-card--complete' : ''}`}
                              >
                                <div className="rc-range-axis-card__header">
                                  <strong>{capture.label}</strong>
                                  <span>Switch</span>
                                </div>
                                <p>{hasLive ? `${livePwm} µs live` : 'No live data'}</p>
                                <div className="rc-range-axis-card__bar" data-testid={`rc-range-bar-ch${channelNumber}`} aria-hidden="true">
                                  {capture.lowObserved ? <div className="rc-range-axis-card__swept" style={{ left: '0%', width: '20%' }} /> : null}
                                  {capture.highObserved ? <div className="rc-range-axis-card__swept" style={{ left: '80%', width: '20%' }} /> : null}
                                  {hasLive ? <div className="rc-range-axis-card__marker" style={{ left: `${pwmPercent(livePwm)}%` }} /> : null}
                                </div>
                                <p>
                                  Min {capture.observedMin !== undefined ? Math.round(capture.observedMin) : 'Unknown'} µs · Max{' '}
                                  {capture.observedMax !== undefined ? Math.round(capture.observedMax) : 'Unknown'} µs
                                </p>
                                <div className="config-pills">
                                  <span className={capture.lowObserved ? 'is-complete' : undefined}>Low</span>
                                  <span className={capture.highObserved ? 'is-complete' : undefined}>High</span>
                                </div>
                              </article>
                            )
                          })}
                        </div>

                        <div className="switch-exercise-controls">
                          <button
                            style={buttonStyle(crsfLink ? 'secondary' : 'primary')}
                            data-testid="receiver-endpoints-capture"
                            onClick={handleStartRcCalibrationCapture}
                            disabled={!canCaptureRcCalibration || rcCalibrationSession.status === 'capturing'}
                          >
                            {crsfLink
                              ? rcCalibrationSession.status === 'ready'
                                ? 'Check Sticks Again'
                                : 'Check Sticks'
                              : rcCalibrationSession.status === 'ready'
                                ? 'Capture Again'
                                : 'Start Capture'}
                          </button>
                          {rcCalibrationSession.status !== 'idle' ? (
                            <button style={buttonStyle()} onClick={handleResetRcCalibrationCapture}>
                              Reset
                            </button>
                          ) : null}
                          {crsfLink ? (
                            <button
                              style={buttonStyle('primary')}
                              data-testid="receiver-set-crsf-limits"
                              onClick={() =>
                                mergeDrafts(buildCrsfEndpointDrafts((paramId) => selectParameterById(snapshot, paramId) !== undefined))
                              }
                            >
                              Set CRSF Limits
                            </button>
                          ) : rcCalibrationSession.status === 'ready' ? (
                            <button
                              style={buttonStyle('secondary')}
                              data-testid="receiver-endpoints-stage"
                              onClick={handleStageRcCalibrationDrafts}
                            >
                              Stage Captured Values
                            </button>
                          ) : null}
                        </div>
                    </div>
                  </div>
                ) : null}

                {activeReceiverTaskId === 'flight-modes' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack receiver-tab-body receiver-tab-body--modes">
                    {modeChannelParameter || modeAssignmentParameters.length > 0 ? (
                      <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-flight-modes-card">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Flight modes</strong>
                            <InfoDot label="About flight modes" wide>
                              Which receiver channel selects the flight mode, and the mode for each of its six
                              switch positions. Changes apply from this tab.
                            </InfoDot>
                          </div>
                          {modeAssignmentParameters.length > 0 ? (
                            <StatusBadge tone={modeExerciseAssignments.length >= 2 ? 'success' : 'warning'}>
                              {modeExerciseAssignments.length >= 2 ? `${modeExerciseAssignments.length} distinct positions` : 'Review needed'}
                            </StatusBadge>
                          ) : null}
                        </div>

                        <div className="scoped-editor-grid">
                          {modeChannelParameter ? (
                            <ScopedSelectField
                              parameter={modeChannelParameter}
                              liveValue={configuredModeChannel}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                              layout="chips"
                            />
                          ) : null}
                          {modeAssignmentParameters.map((parameter) => (
                            <ScopedSelectField
                              key={parameter.id}
                              parameter={parameter}
                              liveValue={parameter.value}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ))}
                        </div>

                        {/* No "FLTMODEn = X" pill row: the selects say the same,
                            and the live monitor's mode line names the active slot. */}
                      </div>
                    ) : null}

                    {/* Arm switch under the modes card, RC options beside them:
                        the two columns come out the same height. */}
                    <div className="receiver-tab-column receiver-tab-column--arm">
                      {armSwitchAvailable ? (
                        <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-arm-switch">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>Arm switch</strong>
                              <InfoDot label="About the arm switch">
                                A channel that arms and disarms the vehicle from a physical switch (RCn_OPTION,
                                written directly). AirMode keeps the stabilisation active at zero throttle.
                              </InfoDot>
                            </div>
                            <StatusBadge tone={armSwitchAssignment.channel !== undefined ? 'success' : 'neutral'}>
                              {armSwitchAssignment.channel !== undefined
                                ? `CH${armSwitchAssignment.channel}${armSwitchAssignment.airmode ? ' + AirMode' : ''}`
                                : 'not assigned'}
                            </StatusBadge>
                          </div>

                          {armSwitchAssignment.channel !== undefined &&
                          rcLogicChannelClaims?.get(armSwitchAssignment.channel)?.length ? (
                            <p className="switch-exercise-warning" data-testid="receiver-arm-switch-rcl-conflict">
                              ⚠ CH{armSwitchAssignment.channel} also drives an RC Mixer function
                              ({rcLogicChannelClaims.get(armSwitchAssignment.channel)!.join(', ')}) — the arm switch
                              and the RC Mixer term both act on this channel.
                            </p>
                          ) : null}

                          <label className="receiver-arm-switch__field">
                            <span>Channel</span>
                            <select
                              data-testid="receiver-arm-switch-channel"
                              value={String(armSwitchAssignment.channel ?? 0)}
                              onChange={(event) =>
                                handleSetArmSwitchChannel(Number(event.target.value), armSwitchAssignment.airmode)
                              }
                            >
                              {armSwitchChannelOptions().map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="receiver-arm-switch__checkbox">
                            <input
                              type="checkbox"
                              data-testid="receiver-arm-switch-airmode"
                              checked={armSwitchAssignment.airmode}
                              disabled={armSwitchAssignment.channel === undefined}
                              onChange={(event) =>
                                handleSetArmSwitchChannel(armSwitchAssignment.channel ?? 0, event.target.checked)
                              }
                            />
                            <span>Also enable AirMode when armed via this switch</span>
                          </label>
                        </div>
                      ) : null}
                    </div>

                    <div className="receiver-tab-column receiver-tab-column--options">
                      {rcOptionsParameter ? (
                        <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-rc-options">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>RC options</strong>
                              <InfoDot label="About RC options">
                                Advanced receiver behaviour (RC_OPTIONS). Leave these off unless a specific receiver
                                or setup needs them.
                              </InfoDot>
                            </div>
                          </div>
                          <ScopedBitmaskField
                            parameter={rcOptionsParameter}
                            liveValue={rcOptionsParameter.value}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeReceiverTaskId === 'functions' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack" data-testid="receiver-functions-panel">
                    <div className="scoped-review-card scoped-review-card--compact">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Auxiliary functions</strong>
                          <InfoDot label="About auxiliary functions" wide>
                            What each AUX channel does (RCn_OPTION). The live PWM beside the channel shows which row
                            moves when you flick a switch. Channels 1 to 4 are the stick axes and are not listed.
                            Tick Reverse on a channel whose switch reads backwards.
                          </InfoDot>
                        </div>
                        <StatusBadge tone={rcFunctionConflicts.length > 0 ? 'danger' : rcFunctionAssigned > 0 ? 'success' : 'neutral'}>
                          {rcFunctionConflicts.length > 0
                            ? `${rcFunctionConflicts.length} conflict${rcFunctionConflicts.length === 1 ? '' : 's'}`
                            : `${rcFunctionAssigned} assigned`}
                        </StatusBadge>
                      </div>

                      {rcFunctionConflicts.length > 0 ? (
                        <p className="switch-exercise-warning" data-testid="receiver-functions-conflict">
                          ⚠ The same function is on more than one channel
                          ({rcFunctionConflicts.map((row) => `CH${row.channelNumber}`).join(', ')}). ArduPilot does not define
                          which one wins — clear the channel you do not want.
                        </p>
                      ) : null}

                      <div className="receiver-functions-grid">
                        {rcFunctionRows.map((row) => {
                          const parameter = receiverSupportParameterById.get(row.paramId)
                          if (!parameter) {
                            return null
                          }
                          return (
                            <div
                              key={row.paramId}
                              className={`receiver-functions-row${row.duplicateChannels.length > 0 ? ' receiver-functions-row--conflict' : ''}`}
                              data-testid={`receiver-function-${row.channelNumber}`}
                            >
                              <span className="receiver-functions-row__channel">
                                <strong>CH{row.channelNumber}</strong>
                                <small>{row.pwm !== undefined ? `${row.pwm} µs` : 'no signal'}</small>
                              </span>
                              <ScopedSelectField
                                parameter={parameter}
                                liveValue={parameter.value}
                                editedValues={editedValues}
                                onChange={(paramId, value) => setDraft(paramId, value)}
                                draftStatusById={parameterDraftById}
                                compact
                              />
                              {renderReverseField(row.channelNumber, `receiver-reverse-${row.channelNumber}`)}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeReceiverTaskId === 'advanced' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack receiver-tab-body receiver-tab-body--signal">
                    {rssiTypeParameter || rssiChannelParameter || rssiChannelLowParameter || rssiChannelHighParameter ? (
                      <div className="scoped-review-card scoped-review-card--compact receiver-rssi-card" data-testid="receiver-rssi-card">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>RSSI</strong>
                            <InfoDot label="About RSSI" wide>
                              Where the link-quality readout comes from. The receiver serial protocol itself is
                              assigned from Ports; this card covers the receiver side of that link. After changing
                              RSSI settings, rerun the RC checks before flight.
                            </InfoDot>
                          </div>
                        </div>

                        <div className="config-pills">
                          <span>RSSI source: {formatArducopterRssiType(rssiType)}</span>
                          <span>Live RX RSSI: {formatRxRssi(snapshot.liveVerification.rcInput.rssi)}</span>
                          {receiverLinkPorts.length > 0
                            ? receiverLinkPorts.map((port) => <span key={`receiver-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                            : <span>No receiver serial link in the current port roles</span>}
                        </div>

                        <div className="scoped-editor-grid">
                          {rssiTypeParameter ? (
                            <ScopedSelectField
                              parameter={rssiTypeParameter}
                              liveValue={rssiType}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelParameter ? (
                            <ScopedField
                              parameter={rssiChannelParameter}
                              liveValue={rssiChannel}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelLowParameter ? (
                            <ScopedField
                              parameter={rssiChannelLowParameter}
                              liveValue={rssiChannelLow}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelHighParameter ? (
                            <ScopedField
                              parameter={rssiChannelHighParameter}
                              liveValue={rssiChannelHigh}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {renderAdditionalSettingsCard(
                      'Additional receiver settings',
                      '',
                      receiverAdditionalGroups,
                      receiverAdditionalDraftEntries,
                      receiverAdditionalStagedDrafts,
                      receiverAdditionalInvalidDrafts,
                      'receiver:additional',
                      'Apply Additional Receiver Changes',
                      'additional receiver settings'
                    )}
                  </div>
                ) : null}
            </>
          }
          helpDockSlot={
            receiverHasPendingReview ? (
              <div className="receiver-review-dock" data-testid="receiver-review-dock">
                <div className="receiver-review-dock__summary">
                  <strong>{allInvalidCount > 0 ? `${allInvalidCount} invalid` : `${allStagedCount} staged`}</strong>
                  <div className="config-pills receiver-review-dock__drafts">
                    {allReceiverDrafts.map((draft) => (
                      <span
                        key={draft.id}
                        className={draft.status === 'invalid' ? 'is-pending' : undefined}
                        title={draft.status === 'staged' ? draft.label : draft.reason}
                      >
                        {draft.id}
                        {draft.status === 'staged'
                          ? ` ${formatParameterValue(draft.currentValue, draft.definition?.unit)} → ${formatParameterValue(draft.nextValue, draft.definition?.unit)}`
                          : draft.status === 'invalid'
                            ? ' invalid'
                            : ''}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="receiver-review-dock__actions">
                  <button
                    data-testid="receiver-discard-button"
                    style={buttonStyle()}
                    onClick={() =>
                      handleDiscardScopedParameterDrafts(allReceiverDrafts.map((entry) => entry.id), 'receiver')
                    }
                    disabled={busyAction !== undefined || allReceiverDrafts.length === 0}
                  >
                    Discard Receiver Changes
                  </button>
                  <button
                    data-testid="receiver-apply-button"
                    style={buttonStyle('primary')}
                    onClick={() =>
                      void handleApplyScopedParameterDrafts(allReceiverDrafts, 'receiver:apply', 'Receiver setup')
                    }
                    disabled={
                      busyAction !== undefined ||
                      allStagedCount === 0 ||
                      allInvalidCount > 0 ||
                      !canApplyDraftParameters
                    }
                  >
                    {busyAction === 'receiver:apply' ? 'Applying…' : `Apply Receiver Changes (${allStagedCount})`}
                  </button>
                </div>
              </div>
            ) : null
          }
        />
  )
}
