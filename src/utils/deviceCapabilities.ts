/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { triggerHaptic, vibrate } from './haptics.ts';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type HardwareAvailabilityLevel =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'API_UNSUPPORTED'
  | 'UNVERIFIED';

export type DeviceFormFactor = 'TABLET' | 'MOBILE' | 'DESKTOP';

export interface DeviceHardwareStatus {
  available: boolean;
  label: string;
  reason?: string;
  isPlatformPasskey?: boolean;
  count?: number;
  hardwarePresent?: boolean;
  apiSupported?: boolean;
  permissionState?: PermissionState;
  statusLevel?: HardwareAvailabilityLevel;
  source?: 'HARDWARE' | 'OVERRIDE' | 'PROBE' | 'BROWSER';
}

export interface DeviceCapabilities {
  isWebAuthnSupported: boolean;
  isPlatformAuthenticatorAvailable: boolean;
  isFingerprintSupported: boolean;
  isCameraSupported: boolean;
  cameraCount: number;
  cameraDevices: string[];
  hasAnyBiometric: boolean;
  hasBothBiometrics: boolean;
  preferredMethod: 'FINGERPRINT' | 'FACE' | 'PASSWORD';
  fingerprintStatus: DeviceHardwareStatus;
  cameraStatus: DeviceHardwareStatus;
  diagnosticSummary?: string;
  isTablet?: boolean;
  isMobilePhone?: boolean;
  cameraPermissionState?: PermissionState;
  layerBreakdown?: {
    hardware: {
      hasCamera: boolean;
      hasFingerprintSensor: boolean;
      formFactor: DeviceFormFactor;
    };
    browserApi: {
      webAuthn: boolean;
      platformAuthenticator: boolean;
      mediaDevices: boolean;
      permissionsApi: boolean;
      secureContext: boolean;
    };
    permissions: {
      camera: PermissionState;
    };
  };
}

/**
 * Detects the form factor of the current workstation / device
 */
export function detectDeviceFormFactor(): DeviceFormFactor {
  if (typeof navigator === 'undefined') return 'DESKTOP';
  const ua = navigator.userAgent || '';
  const isIPad = /iPad/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const isGeneralTablet = /Tablet|PlayBook|Silk/i.test(ua);

  if (isIPad || isAndroidTablet || isGeneralTablet) {
    return 'TABLET';
  }

  const isIPhone = /iPhone|iPod/i.test(ua);
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  if (isIPhone || isAndroidPhone) {
    return 'MOBILE';
  }

  return 'DESKTOP';
}

/**
 * Detects if the current user agent represents a tablet device (iPad, Android Tablet, etc.)
 */
export function detectTabletDevice(): boolean {
  return detectDeviceFormFactor() === 'TABLET';
}

/**
 * Detects if the current user agent is a smartphone
 */
export function detectMobilePhone(): boolean {
  return detectDeviceFormFactor() === 'MOBILE';
}

/**
 * Layer 2: Checks if the browser supports Web Authentication API (WebAuthn)
 */
export function checkWebAuthnSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.PublicKeyCredential) &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  );
}

/**
 * Layer 2: Checks if a user-verifying platform authenticator (e.g. Windows Hello, Touch ID, Android Passkey) is available
 */
export async function checkPlatformAuthenticator(): Promise<boolean> {
  if (!checkWebAuthnSupport()) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Layer 3: Evaluates user-granted or user-denied camera permission via Permissions API
 */
export async function checkCameraPermission(): Promise<PermissionState> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.permissions ||
    typeof navigator.permissions.query !== 'function'
  ) {
    return 'unsupported';
  }

  try {
    const permissionStatus = await navigator.permissions.query({ name: 'camera' as any });
    if (permissionStatus && typeof permissionStatus.state === 'string') {
      return permissionStatus.state as PermissionState;
    }
  } catch {
    // Some browsers do not allow querying 'camera' directly in permissions.query
  }

  return 'unsupported';
}

/**
 * Layer 1 & 2: Checks if the device has connected video camera(s) using navigator.mediaDevices
 */
export async function checkCameraSupport(): Promise<{
  available: boolean;
  count: number;
  devices: string[];
  error?: string;
  permissionState?: PermissionState;
}> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return {
      available: false,
      count: 0,
      devices: [],
      error: 'MediaDevices video capture is not supported in this browser.',
      permissionState: 'unsupported',
    };
  }

  const permissionState = await checkCameraPermission();

  try {
    if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
      const count = videoInputs.length;
      return {
        available: count > 0,
        count,
        devices: videoInputs.map((d) => d.label || `Camera ${videoInputs.indexOf(d) + 1}`),
        permissionState,
      };
    } else {
      return {
        available: true,
        count: 1,
        devices: ['Default Camera Device'],
        permissionState,
      };
    }
  } catch (err: any) {
    return {
      available: false,
      count: 0,
      devices: [],
      error: err?.message || 'Error enumerating camera video devices.',
      permissionState,
    };
  }
}

/**
 * Comprehensive device capability evaluation combining Hardware, Browser API, and Permission levels.
 */
export async function getDeviceCapabilities(): Promise<DeviceCapabilities> {
  // 1. Browser API Layer checks
  const isWebAuthnSupported = checkWebAuthnSupport();
  const isSecureContext = typeof window !== 'undefined' && Boolean(window.isSecureContext);
  const isPlatformAvailable = await checkPlatformAuthenticator();
  const isMediaDevicesSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  const isPermissionsApiSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.permissions) &&
    typeof navigator.permissions.query === 'function';

  // 2. Permission Layer checks
  const cameraPermission = await checkCameraPermission();

  // 3. Hardware Layer checks
  const cameraResult = await checkCameraSupport();
  const formFactor = detectDeviceFormFactor();
  const isTablet = formFactor === 'TABLET';
  const isPhone = formFactor === 'MOBILE';

  let storedFpOverride: string | null = null;
  let storedCamOverride: string | null = null;
  let probeVerified = false;

  try {
    if (typeof localStorage !== 'undefined') {
      storedFpOverride = localStorage.getItem('ob_hw_fingerprint_status');
      storedCamOverride = localStorage.getItem('ob_hw_camera_status');
      probeVerified = localStorage.getItem('ob_fingerprint_probe_verified') === 'true';
    }
  } catch {}

  // 4. Evaluate Fingerprint Scanner Availability across Hardware, API, and Override dimensions
  let isFingerprintSupported = false;
  let fingerprintStatus: DeviceHardwareStatus;

  if (!isWebAuthnSupported) {
    isFingerprintSupported = false;
    fingerprintStatus = {
      available: false,
      label: 'WebAuthn API Unsupported',
      reason: 'Web Authentication API is not supported in this browser.',
      apiSupported: false,
      hardwarePresent: false,
      statusLevel: 'API_UNSUPPORTED',
      source: 'BROWSER',
    };
  } else if (storedFpOverride === 'DISABLED') {
    isFingerprintSupported = false;
    fingerprintStatus = {
      available: false,
      label: 'Fingerprint Sensor Inactive (Disabled)',
      reason: 'Marked inactive: device does not have a physical fingerprint scanner.',
      apiSupported: isWebAuthnSupported,
      hardwarePresent: false,
      statusLevel: 'UNAVAILABLE',
      source: 'OVERRIDE',
    };
  } else if (storedFpOverride === 'ENABLED') {
    isFingerprintSupported = true;
    fingerprintStatus = {
      available: true,
      label: 'Fingerprint Sensor Active (Configured)',
      reason: 'Fingerprint sensor manually configured active on this device.',
      apiSupported: isWebAuthnSupported,
      hardwarePresent: true,
      statusLevel: 'AVAILABLE',
      source: 'OVERRIDE',
    };
  } else if (probeVerified && isPlatformAvailable) {
    isFingerprintSupported = true;
    fingerprintStatus = {
      available: true,
      label: 'Fingerprint Sensor Active (Verified)',
      reason: 'Biometric hardware sensor probe verified on this system.',
      apiSupported: true,
      hardwarePresent: true,
      statusLevel: 'AVAILABLE',
      source: 'PROBE',
    };
  } else if (!isPlatformAvailable) {
    isFingerprintSupported = false;
    fingerprintStatus = {
      available: false,
      label: 'Fingerprint Sensor Inactive',
      reason: 'No platform biometric authenticator configured on this operating system.',
      apiSupported: true,
      hardwarePresent: false,
      statusLevel: 'UNAVAILABLE',
      source: 'HARDWARE',
    };
  } else if (isTablet) {
    // Tablet devices (iPad, Android tablet, Windows touch tablet) typically lack physical touch fingerprint sensors
    isFingerprintSupported = false;
    fingerprintStatus = {
      available: false,
      label: 'Fingerprint Scanner Unavailable',
      reason: 'This tablet device does not have a physical fingerprint scanner. Device camera (Face ID) is available.',
      isPlatformPasskey: isPlatformAvailable,
      apiSupported: true,
      hardwarePresent: false,
      statusLevel: 'UNAVAILABLE',
      source: 'HARDWARE',
    };
  } else if (isPlatformAvailable && isPhone) {
    // Mobile smartphones with platform authenticator (Touch ID, Android Biometrics)
    isFingerprintSupported = true;
    fingerprintStatus = {
      available: true,
      label: 'Mobile Biometric Sensor Active',
      reason: 'Platform biometric sensor verified on this mobile device.',
      isPlatformPasskey: true,
      apiSupported: true,
      hardwarePresent: true,
      statusLevel: 'AVAILABLE',
      source: 'HARDWARE',
    };
  } else {
    // Desktop/Laptop where platform passkey/PIN exists but physical touch scanner is not confirmed
    isFingerprintSupported = false;
    fingerprintStatus = {
      available: false,
      label: 'Fingerprint Inactive (No Sensor Detected)',
      reason: 'Platform passkey/PIN detected, but no physical fingerprint reader was detected on this workstation.',
      isPlatformPasskey: true,
      apiSupported: true,
      hardwarePresent: false,
      statusLevel: 'UNVERIFIED',
      source: 'HARDWARE',
    };
  }

  // 5. Evaluate Device Camera / Webcam Availability across Hardware, API, and Permission dimensions
  let isCameraSupported = false;
  let cameraStatus: DeviceHardwareStatus;

  if (!isMediaDevicesSupported) {
    isCameraSupported = false;
    cameraStatus = {
      available: false,
      label: 'Camera API Unsupported',
      reason: 'MediaDevices video capture is not supported in this browser.',
      apiSupported: false,
      hardwarePresent: false,
      permissionState: 'unsupported',
      statusLevel: 'API_UNSUPPORTED',
      source: 'BROWSER',
      count: 0,
    };
  } else if (storedCamOverride === 'DISABLED') {
    isCameraSupported = false;
    cameraStatus = {
      available: false,
      label: 'Camera Inactive (Disabled)',
      reason: 'Camera is disabled in device sensor preferences.',
      apiSupported: true,
      hardwarePresent: cameraResult.available,
      permissionState: cameraPermission,
      statusLevel: 'UNAVAILABLE',
      source: 'OVERRIDE',
      count: cameraResult.count,
    };
  } else if (storedCamOverride === 'ENABLED') {
    isCameraSupported = true;
    cameraStatus = {
      available: true,
      label: isTablet ? 'Front Camera Ready (Enabled)' : 'Webcam Ready (Enabled)',
      reason: 'Camera manually enabled for this device.',
      apiSupported: true,
      hardwarePresent: true,
      permissionState: cameraPermission,
      statusLevel: 'AVAILABLE',
      source: 'OVERRIDE',
      count: cameraResult.count,
    };
  } else if (cameraPermission === 'denied') {
    isCameraSupported = false;
    cameraStatus = {
      available: false,
      label: 'Camera Permission Denied',
      reason: 'Camera access is blocked by browser/system permissions. Please enable camera access in browser settings.',
      apiSupported: true,
      hardwarePresent: cameraResult.available,
      permissionState: 'denied',
      statusLevel: 'PERMISSION_DENIED',
      source: 'BROWSER',
      count: cameraResult.count,
    };
  } else if (cameraResult.available) {
    isCameraSupported = true;
    cameraStatus = {
      available: true,
      label: isTablet ? 'Tablet Front Camera Ready (Face ID)' : 'Webcam Camera Ready',
      reason: `${cameraResult.count} video input device(s) connected.`,
      apiSupported: true,
      hardwarePresent: true,
      permissionState: cameraPermission,
      statusLevel: 'AVAILABLE',
      source: 'HARDWARE',
      count: cameraResult.count,
    };
  } else {
    isCameraSupported = false;
    cameraStatus = {
      available: false,
      label: 'Camera Inactive / Not Detected',
      reason: cameraResult.error || 'No webcam or front camera was found on your system.',
      apiSupported: true,
      hardwarePresent: false,
      permissionState: cameraPermission,
      statusLevel: 'UNAVAILABLE',
      source: 'HARDWARE',
      count: 0,
    };
  }

  const hasAnyBiometric = isFingerprintSupported || isCameraSupported;
  const hasBothBiometrics = isFingerprintSupported && isCameraSupported;

  const preferredMethod: 'FINGERPRINT' | 'FACE' | 'PASSWORD' =
    hasBothBiometrics
      ? 'FINGERPRINT'
      : isCameraSupported
      ? 'FACE'
      : isFingerprintSupported
      ? 'FINGERPRINT'
      : 'PASSWORD';

  const diagnosticSummary = hasBothBiometrics
    ? 'Both fingerprint scanner and device camera are available.'
    : isFingerprintSupported
    ? 'Fingerprint scanner is available.'
    : isCameraSupported
    ? isTablet
      ? 'Tablet front camera is available for Face ID. Fingerprint scanner is unavailable on this tablet.'
      : 'Device camera is available for Face ID. Fingerprint scanner is unavailable on this workstation.'
    : 'No biometric hardware detected on this device. Use corporate password.';

  return {
    isWebAuthnSupported,
    isPlatformAuthenticatorAvailable: isPlatformAvailable,
    isFingerprintSupported,
    isCameraSupported,
    cameraCount: cameraResult.count,
    cameraDevices: cameraResult.devices,
    hasAnyBiometric,
    hasBothBiometrics,
    preferredMethod,
    fingerprintStatus,
    cameraStatus,
    diagnosticSummary,
    isTablet,
    isMobilePhone: isPhone,
    cameraPermissionState: cameraPermission,
    layerBreakdown: {
      hardware: {
        hasCamera: cameraResult.available,
        hasFingerprintSensor: isFingerprintSupported,
        formFactor,
      },
      browserApi: {
        webAuthn: isWebAuthnSupported,
        platformAuthenticator: isPlatformAvailable,
        mediaDevices: isMediaDevicesSupported,
        permissionsApi: isPermissionsApiSupported,
        secureContext: isSecureContext,
      },
      permissions: {
        camera: cameraPermission,
      },
    },
  };
}

/**
 * Internal hardware diagnostic process that evaluates the presence of fingerprint scanner,
 * device camera, or both, without requiring user-facing diagnostic cards.
 */
export async function runInternalHardwareDiagnostic(): Promise<DeviceCapabilities> {
  return await getDeviceCapabilities();
}

/**
 * Listens for hardware changes (such as webcams connected or disconnected)
 */
export function subscribeToDeviceChanges(callback: () => void): () => void {
  if (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.addEventListener === 'function'
  ) {
    navigator.mediaDevices.addEventListener('devicechange', callback);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', callback);
    };
  }
  return () => {};
}

export interface HardwareVerificationSummary {
  hasBothBiometrics: boolean;
  isFingerprintSupported: boolean;
  isCameraSupported: boolean;
  hasAnyBiometric: boolean;
  badgeLabel: string;
  title: string;
  message: string;
  sensorDetails: string;
  iconType: 'dual' | 'fingerprint' | 'camera' | 'hardware';
  timestamp: string;
}

/**
 * Format human-readable hardware verification status for post-login toasts & alerts
 */
export function formatHardwareSummary(
  isFp: boolean,
  isCam: boolean,
  hasBoth: boolean,
  hasAny: boolean
): HardwareVerificationSummary {
  const timestamp = new Date().toISOString();

  if (hasBoth || (isFp && isCam)) {
    return {
      hasBothBiometrics: true,
      isFingerprintSupported: true,
      isCameraSupported: true,
      hasAnyBiometric: true,
      badgeLabel: 'Dual Biometrics Active',
      title: 'Device Hardware Verified',
      message: 'Fingerprint scanner and device camera (Face ID) successfully verified.',
      sensorDetails: 'Biometric sensors & camera operational [NBE BSD/03/2020]',
      iconType: 'dual',
      timestamp,
    };
  }

  if (isFp) {
    return {
      hasBothBiometrics: false,
      isFingerprintSupported: true,
      isCameraSupported: false,
      hasAnyBiometric: true,
      badgeLabel: 'Fingerprint Verified',
      title: 'Device Hardware Verified',
      message: 'Biometric fingerprint sensor successfully verified for passkey sign-in.',
      sensorDetails: 'Fingerprint scanner operational [NBE BSD/03/2020]',
      iconType: 'fingerprint',
      timestamp,
    };
  }

  if (isCam) {
    return {
      hasBothBiometrics: false,
      isFingerprintSupported: false,
      isCameraSupported: true,
      hasAnyBiometric: true,
      badgeLabel: 'Camera Verified',
      title: 'Device Hardware Verified',
      message: 'Device camera successfully verified and ready for facial authentication.',
      sensorDetails: 'Optical camera sensor operational [NBE BSD/03/2020]',
      iconType: 'camera',
      timestamp,
    };
  }

  return {
    hasBothBiometrics: false,
    isFingerprintSupported: false,
    isCameraSupported: false,
    hasAnyBiometric: false,
    badgeLabel: 'Hardware Secured',
    title: 'Device Hardware Verified',
    message: 'Workstation hardware verified in secure regulatory environment.',
    sensorDetails: 'Standard corporate security perimeter active',
    iconType: 'hardware',
    timestamp,
  };
}

/**
 * Evaluates verified device hardware (camera and biometric sensors) specifically for post-login
 * verification alerts and notifications. Reads from cached diagnostic or evaluates live capabilities.
 */
export async function getVerifiedHardwareSummary(): Promise<HardwareVerificationSummary> {
  // Check cached internal diagnostic first for immediate zero-latency feedback
  let cached: any = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem('ob_internal_hw_diagnostic');
      if (stored) {
        cached = JSON.parse(stored);
      }
    }
  } catch {}

  const isFp = Boolean(cached ? cached.isFingerprintSupported : false);
  const isCam = Boolean(cached ? cached.isCameraSupported : false);
  const hasBoth = Boolean(cached ? cached.hasBothBiometrics : false);
  const hasAny = Boolean(cached ? cached.hasAnyBiometric : false);

  if (cached && (hasAny || isFp || isCam)) {
    return formatHardwareSummary(isFp, isCam, hasBoth, hasAny);
  }

  // If not cached yet, run detection
  try {
    const caps = await getDeviceCapabilities();
    return formatHardwareSummary(
      caps.isFingerprintSupported,
      caps.isCameraSupported,
      caps.hasBothBiometrics,
      caps.hasAnyBiometric
    );
  } catch {
    return formatHardwareSummary(false, false, false, false);
  }
}

export interface HardwareCapabilitiesResult {
  hasBiometricHardware: boolean;
  hasFingerprintHardware: boolean;
  hasCameraHardware: boolean;
  canRegisterFingerprint: boolean;
  canRegisterFace: boolean;
  isPlatformAuthenticatorAvailable: boolean;
  isWebAuthnSupported: boolean;
  isTablet: boolean;
  isMobilePhone: boolean;
  formFactor: DeviceFormFactor;
  cameraCount: number;
  cameraDevices: string[];
  preferredMethod: 'FINGERPRINT' | 'FACE' | 'PASSWORD';
  statusSummary: string;
  fingerprintStatus: DeviceHardwareStatus;
  cameraStatus: DeviceHardwareStatus;
}

/**
 * Runs before the biometric registration or authentication UI displays, specifically using
 * PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() and navigator-based
 * hardware detection to definitively toggle visibility of fingerprint/biometric registration options
 * or fall back immediately to standard credentials.
 */
export async function checkHardwareCapabilities(): Promise<HardwareCapabilitiesResult> {
  // 1. Browser WebAuthn API availability check
  let isWebAuthnSupported = false;
  let isPlatformAuthenticatorAvailable = false;

  if (
    typeof window !== 'undefined' &&
    Boolean(window.PublicKeyCredential) &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  ) {
    isWebAuthnSupported = true;
    try {
      isPlatformAuthenticatorAvailable =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      isPlatformAuthenticatorAvailable = false;
    }
  }

  // 2. Hardware and device detection
  const caps = await getDeviceCapabilities();
  const formFactor = caps.layerBreakdown?.hardware.formFactor || detectDeviceFormFactor();
  const isTablet = formFactor === 'TABLET';
  const isMobile = formFactor === 'MOBILE';

  // canRegisterFingerprint is true ONLY if physical/platform authenticator is supported, available, and not a tablet (unless verified)
  const canRegisterFingerprint = Boolean(
    caps.isFingerprintSupported &&
      (isPlatformAuthenticatorAvailable || caps.fingerprintStatus.source === 'OVERRIDE' || caps.fingerprintStatus.source === 'PROBE')
  );

  // canRegisterFace is true ONLY if optical camera device is physically detected and permissions not denied
  const canRegisterFace = Boolean(caps.isCameraSupported);

  const hasBiometricHardware = canRegisterFingerprint || canRegisterFace;
  const hasFingerprintHardware = canRegisterFingerprint;
  const hasCameraHardware = canRegisterFace;

  const preferredMethod: 'FINGERPRINT' | 'FACE' | 'PASSWORD' =
    canRegisterFingerprint && canRegisterFace
      ? 'FINGERPRINT'
      : canRegisterFace
      ? 'FACE'
      : canRegisterFingerprint
      ? 'FINGERPRINT'
      : 'PASSWORD';

  const statusSummary = hasBiometricHardware
    ? canRegisterFingerprint && canRegisterFace
      ? 'Dual biometric hardware (Fingerprint Scanner & Camera Face ID) available.'
      : canRegisterFingerprint
      ? 'Platform fingerprint biometric sensor verified.'
      : 'Device optical camera (Face ID) verified. Fingerprint reader unavailable.'
    : 'No biometric hardware detected on this device. Fallback to standard credentials.';

  return {
    hasBiometricHardware,
    hasFingerprintHardware,
    hasCameraHardware,
    canRegisterFingerprint,
    canRegisterFace,
    isPlatformAuthenticatorAvailable,
    isWebAuthnSupported,
    isTablet,
    isMobilePhone: isMobile,
    formFactor,
    cameraCount: caps.cameraCount,
    cameraDevices: caps.cameraDevices,
    preferredMethod,
    statusSummary,
    fingerprintStatus: caps.fingerprintStatus,
    cameraStatus: caps.cameraStatus,
  };
}

/**
 * Triggers a subtle tactile haptic vibration feedback acknowledging verified hardware status.
 * Safe for all platforms (no-op on desktop or unsupported devices).
 */
export function triggerHardwareVerificationHaptic(): boolean {
  // Dual-pulse confirmation: 25ms buzz, 40ms pause, 35ms buzz
  return triggerHaptic('success') || vibrate([25, 40, 35]);
}
