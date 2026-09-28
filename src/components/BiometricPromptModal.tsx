/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Fingerprint,
  ScanFace,
  CheckCircle2,
  ShieldCheck,
  X,
  Sparkles,
  Camera,
  AlertCircle,
  VideoOff,
  Lock,
  RefreshCw,
  Sliders,
  Clock,
  TimerOff,
  RotateCcw,
} from 'lucide-react';
import { vibrate, haptics } from '../utils/haptics.ts';
import { useBiometricAuth } from '../hooks/useBiometricAuth.ts';
import { HardwareDiagnosticsModal } from './HardwareDiagnosticsModal.tsx';
import { recordBiometricAuditLog } from './AuditTrailView.tsx';

const INACTIVITY_TIMEOUT_SECONDS = 30;

interface BiometricPromptModalProps {
  isOpen: boolean;
  mode: 'REGISTER' | 'AUTHENTICATE';
  userName?: string;
  userEmail?: string;
  userRole?: string;
  initialMethod?: 'FINGERPRINT' | 'FACE';
  onSuccess: (method: 'FINGERPRINT' | 'FACE', faceData?: { imageBase64?: string; faceHash?: string }) => void;
  onCancel: () => void;
}

export const BiometricPromptModal: React.FC<BiometricPromptModalProps> = ({
  isOpen,
  mode,
  userName = 'Bank Officer',
  userEmail = 'user@oromiabank.com',
  userRole = 'MAKER',
  initialMethod,
  onSuccess,
  onCancel,
}) => {
  const {
    isFingerprintSupported,
    fingerprintStatus,
    isCameraSupported,
    cameraStatus,
    startCameraStream,
    stopCameraStream,
    captureFaceFrame,
    register,
    login,
  } = useBiometricAuth();

  const [authType, setAuthType] = useState<'FINGERPRINT' | 'FACE'>('FINGERPRINT');
  const [scanState, setScanState] = useState<'IDLE' | 'SCANNING' | 'SUCCESS' | 'ERROR' | 'TIMEOUT'>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(INACTIVITY_TIMEOUT_SECONDS);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = useCallback(() => {
    setTimeLeft(INACTIVITY_TIMEOUT_SECONDS);
  }, []);

  // Initialize preferred method according to hardware availability
  useEffect(() => {
    if (isOpen) {
      setScanState('IDLE');
      setStatusMessage(null);
      resetTimer();
      vibrate(20);

      if (initialMethod && ((initialMethod === 'FINGERPRINT' && isFingerprintSupported) || (initialMethod === 'FACE' && isCameraSupported))) {
        setAuthType(initialMethod);
      } else if (initialMethod === 'FACE' || (isCameraSupported && !isFingerprintSupported)) {
        setAuthType('FACE');
      } else if (initialMethod === 'FINGERPRINT' || isFingerprintSupported) {
        setAuthType('FINGERPRINT');
      } else {
        setAuthType(isCameraSupported ? 'FACE' : 'FINGERPRINT');
      }
    } else {
      stopCameraStream();
      setCameraActive(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isOpen, initialMethod, isFingerprintSupported, isCameraSupported, stopCameraStream, resetTimer]);

  // 30-Second Inactivity Auto-Cancellation Countdown Timer
  useEffect(() => {
    if (!isOpen || scanState === 'SUCCESS' || scanState === 'TIMEOUT') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleAutoCancelTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, scanState, authType]);

  const handleAutoCancelTimeout = useCallback(() => {
    stopCameraStream();
    setCameraActive(false);
    setScanState('TIMEOUT');
    setStatusMessage('Authentication attempt auto-cancelled after 30s of inactivity to prevent hardware lock.');
    vibrate([40, 50, 40]);
    haptics.error();

    // Record official NBE compliance audit log
    recordBiometricAuditLog({
      actorId: userEmail,
      actorName: userName,
      actorRole: userRole,
      action: 'BIOMETRIC_AUTH_TIMEOUT',
      type: authType,
      entityId: userEmail,
      details: `[NBE Directive BSD/03/2020 Compliance] Biometric ${authType} authentication auto-cancelled after 30 seconds of inactivity to release device hardware lock.`,
      errorMessage: 'Inactivity timer expired (30 seconds)',
    }).catch(() => {});
  }, [authType, stopCameraStream, userEmail, userName, userRole]);

  // Request browser camera stream with user permission
  const requestCameraStream = useCallback(async () => {
    setStatusMessage('Requesting camera access...');
    try {
      const res = await startCameraStream(videoRef.current);
      if (res.success) {
        setCameraActive(true);
        setStatusMessage('Center your face in the camera frame');
        return true;
      } else {
        setCameraActive(false);
        setStatusMessage(res.error || 'Unable to access device camera.');
        return false;
      }
    } catch (err: any) {
      setCameraActive(false);
      setStatusMessage(err?.message || 'Camera permission denied.');
      return false;
    }
  }, [startCameraStream]);

  // Manage camera stream when switching to/from FACE mode
  useEffect(() => {
    let active = true;

    if (isOpen && authType === 'FACE' && scanState !== 'TIMEOUT') {
      requestCameraStream().then((success) => {
        if (!active) return;
      });
    } else {
      stopCameraStream();
      setCameraActive(false);
    }

    return () => {
      active = false;
      stopCameraStream();
    };
  }, [isOpen, authType, scanState, requestCameraStream, stopCameraStream]);

  if (!isOpen) return null;

  const handleSwitchType = (type: 'FINGERPRINT' | 'FACE') => {
    if (type === 'FINGERPRINT' && !isFingerprintSupported) return;
    if (type === 'FACE' && !isCameraSupported) return;
    vibrate(15);
    setAuthType(type);
    setScanState('IDLE');
    setStatusMessage(null);
    resetTimer();
  };

  /**
   * Handle Retry after Timeout or Error
   */
  const handleRetry = () => {
    vibrate([20, 25]);
    resetTimer();
    setScanState('IDLE');
    setStatusMessage(null);

    if (authType === 'FACE') {
      requestCameraStream();
    }
  };

  /**
   * Real Execution of Biometric Action
   */
  const handleExecuteBiometric = async () => {
    if (scanState === 'SCANNING' || scanState === 'SUCCESS') return;

    resetTimer();
    setScanState('SCANNING');
    setStatusMessage(null);
    vibrate([20, 30, 20]);
    haptics.medium();

    try {
      if (authType === 'FACE') {
        // Real Camera Frame Capture
        if (!videoRef.current) {
          throw new Error('Video stream element not initialized.');
        }

        const captured = captureFaceFrame(videoRef.current);
        if (!captured.success || !captured.faceHash) {
          throw new Error(captured.error || 'Please look directly at camera to scan face.');
        }

        if (mode === 'REGISTER') {
          const res = await register(userEmail, 'FACE', {
            imageBase64: captured.imageBase64,
            faceHash: captured.faceHash,
          });
          if (!res.success) throw new Error(res.error || 'Failed to register facial passkey.');
          
          await recordBiometricAuditLog({
            actorId: userEmail,
            actorName: userName,
            actorRole: userRole,
            action: 'BIOMETRIC_ENROLLED',
            type: 'FACE',
            entityId: userEmail,
            details: `[NBE Directive BSD/03/2020 Compliance] Facial biometric profile registered successfully for ${userEmail}.`,
          });
        } else {
          const res = await login(userEmail, 'FACE', {
            imageBase64: captured.imageBase64,
            faceHash: captured.faceHash,
          });
          if (!res.success) throw new Error(res.error || 'Facial verification rejected.');

          await recordBiometricAuditLog({
            actorId: userEmail,
            actorName: userName,
            actorRole: userRole,
            action: 'BIOMETRIC_AUTH_SUCCESS',
            type: 'FACE',
            entityId: userEmail,
            details: `[NBE Directive BSD/03/2020 Compliance] Face ID authentication verified for ${userEmail} (${userRole}).`,
          });
        }

        setScanState('SUCCESS');
        vibrate([30, 50, 40]);
        haptics.success();
        stopCameraStream();

        setTimeout(() => {
          onSuccess('FACE', {
            imageBase64: captured.imageBase64,
            faceHash: captured.faceHash,
          });
        }, 550);
      } else {
        // Real Fingerprint Authenticator
        if (!isFingerprintSupported) {
          throw new Error('Fingerprint scanner is not available on this tablet/device. Please use Face ID (Camera) or Password.');
        }

        if (mode === 'REGISTER') {
          const res = await register(userEmail, 'FINGERPRINT');
          if (!res.success) throw new Error(res.error || 'Fingerprint registration cancelled or failed.');

          await recordBiometricAuditLog({
            actorId: userEmail,
            actorName: userName,
            actorRole: userRole,
            action: 'BIOMETRIC_ENROLLED',
            type: 'FINGERPRINT',
            entityId: userEmail,
            details: `[NBE Directive BSD/03/2020 Compliance] Fingerprint passkey enrolled successfully for ${userEmail}.`,
          });
        } else {
          const res = await login(userEmail, 'FINGERPRINT');
          if (!res.success) throw new Error(res.error || 'Fingerprint verification failed.');

          await recordBiometricAuditLog({
            actorId: userEmail,
            actorName: userName,
            actorRole: userRole,
            action: 'BIOMETRIC_AUTH_SUCCESS',
            type: 'FINGERPRINT',
            entityId: userEmail,
            details: `[NBE Directive BSD/03/2020 Compliance] Fingerprint authentication verified for ${userEmail} (${userRole}).`,
          });
        }

        setScanState('SUCCESS');
        vibrate([30, 50, 40]);
        haptics.success();

        setTimeout(() => {
          onSuccess('FINGERPRINT');
        }, 550);
      }
    } catch (err: any) {
      setScanState('ERROR');
      const msg = err?.message || 'Biometric challenge did not succeed.';
      setStatusMessage(msg);
      vibrate([50, 60, 50]);
      haptics.error();

      await recordBiometricAuditLog({
        actorId: userEmail,
        actorName: userName,
        actorRole: userRole,
        action: 'BIOMETRIC_AUTH_FAILURE',
        type: authType,
        entityId: userEmail,
        errorMessage: msg,
        details: `[NBE Directive BSD/03/2020 Compliance] Biometric ${authType} challenge failed for ${userEmail}: ${msg}`,
      }).catch(() => {});
    }
  };

  const isCurrentMethodAvailable =
    authType === 'FINGERPRINT' ? isFingerprintSupported : isCameraSupported;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-white dark:bg-[#121428] border border-slate-200 dark:border-[#262D55] rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 text-center transition-all animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-250">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
              authType === 'FACE'
                ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400'
                : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            }`}>
              {authType === 'FACE' ? <ScanFace className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              {mode === 'REGISTER'
                ? authType === 'FACE'
                  ? 'Register Face ID Passkey'
                  : 'Register Fingerprint Passkey'
                : authType === 'FACE'
                ? 'Face ID Webcam Sign-In'
                : 'Fingerprint Biometric Sign-In'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onCancel();
            }}
            className="min-h-[44px] min-w-[44px] -mr-2 -my-2 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full transition-colors cursor-pointer touch-press"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User Account Info */}
        <div className="bg-slate-50 dark:bg-[#181C3B] border border-slate-200 dark:border-[#2B3369] rounded-2xl p-2.5 flex items-center justify-between gap-3 text-left">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {userName}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {userEmail}
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-ob-indigo-50 dark:bg-ob-indigo-950 text-ob-indigo-700 dark:text-ob-indigo-300 border border-ob-indigo-200 dark:border-ob-indigo-800 shrink-0">
            {userRole}
          </span>
        </div>

        {/* Device Hardware Support Summary & Inactivity Countdown Pill */}
        <div className="text-[11px] px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#181C3B] border border-slate-200 dark:border-[#2B3369] flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Status:</span>
            {authType === 'FACE' ? (
              cameraActive ? (
                <span className="text-teal-700 dark:text-teal-300 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                  Face ID Webcam Ready
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                  Webcam Awaiting Permission
                </span>
              )
            ) : isFingerprintSupported ? (
              <span className="text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Fingerprint Sensor Ready
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                Sensor Unavailable
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsDiagnosticsOpen(true)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded transition-colors cursor-pointer"
              title="Test & calibrate hardware sensors"
            >
              <Sliders className="w-3 h-3 text-ob-indigo-500" />
            </button>
          </div>

          {/* Inactivity Auto-Cancellation Countdown Badge */}
          {scanState !== 'SUCCESS' && (
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-colors ${
                scanState === 'TIMEOUT'
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800'
                  : timeLeft <= 10
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 animate-pulse'
                  : 'bg-slate-200/60 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
              }`}
              title="Auto-cancellation after 30 seconds of inactivity to prevent long-running hardware locks"
            >
              <Clock className="w-3 h-3" />
              <span>{scanState === 'TIMEOUT' ? 'Expired' : `${timeLeft}s`}</span>
            </div>
          )}
        </div>

        {/* Biometric Type Selector with Real Hardware Status Badges */}
        <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          {/* Fingerprint Option */}
          <button
            type="button"
            disabled={!isFingerprintSupported}
            onClick={() => handleSwitchType('FINGERPRINT')}
            className={`min-h-[48px] p-1.5 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition-all relative ${
              authType === 'FINGERPRINT' && isFingerprintSupported
                ? 'bg-white dark:bg-[#1C2145] text-emerald-600 dark:text-emerald-400 shadow-sm border border-emerald-500/40 cursor-pointer touch-press'
                : isFingerprintSupported
                ? 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer touch-press'
                : 'opacity-40 text-slate-400 dark:text-slate-600 cursor-not-allowed bg-slate-200/40 dark:bg-slate-800/40'
            }`}
            title={isFingerprintSupported ? 'Switch to Fingerprint scanner' : 'Fingerprint scanner not detected on this hardware'}
          >
            <div className="flex items-center gap-1.5">
              <Fingerprint className="w-4 h-4" />
              <span>Fingerprint</span>
            </div>
            <span
              className={`text-[9px] flex items-center gap-1 font-normal ${
                isFingerprintSupported
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isFingerprintSupported ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              ></span>
              {isFingerprintSupported ? 'Sensor Ready' : 'Inactive / None'}
            </span>
          </button>

          {/* Face ID / Webcam Option */}
          <button
            type="button"
            disabled={!isCameraSupported}
            onClick={() => handleSwitchType('FACE')}
            className={`min-h-[48px] p-1.5 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition-all relative ${
              authType === 'FACE' && isCameraSupported
                ? 'bg-white dark:bg-[#1C2145] text-teal-600 dark:text-teal-400 shadow-sm border border-teal-500/40 cursor-pointer touch-press'
                : isCameraSupported
                ? 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer touch-press'
                : 'opacity-40 text-slate-400 dark:text-slate-600 cursor-not-allowed bg-slate-200/40 dark:bg-slate-800/40'
            }`}
            title={isCameraSupported ? 'Switch to Face ID webcam' : 'Webcam or camera not detected on this device'}
          >
            <div className="flex items-center gap-1.5">
              <ScanFace className="w-4 h-4" />
              <span>Face ID</span>
            </div>
            <span
              className={`text-[9px] flex items-center gap-1 font-normal ${
                isCameraSupported
                  ? 'text-teal-600 dark:text-teal-400 font-semibold'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  cameraActive ? 'bg-teal-500 animate-pulse' : isCameraSupported ? 'bg-amber-500' : 'bg-slate-400'
                }`}
              ></span>
              {cameraActive ? 'Webcam Ready' : isCameraSupported ? 'Click to Enable' : 'Inactive / None'}
            </span>
          </button>
        </div>

        {/* Interactive Biometric Viewport (Real Camera Feed OR Fingerprint Target OR Timeout State) */}
        {scanState === 'TIMEOUT' ? (
          /* 30-Second Inactivity Timeout Screen with Retry Prompt */
          <div className="py-4 px-3 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800/80 rounded-2xl text-center space-y-2.5 animate-in fade-in zoom-in-95 duration-200">
            <div className="relative w-14 h-14 mx-auto flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 shadow-sm">
              <TimerOff className="w-7 h-7 animate-pulse" />
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-amber-600 text-white text-[9px] font-bold rounded-full">
                30s
              </span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Session Inactivity Timeout
              </h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 max-w-xs mx-auto leading-relaxed mt-1">
                Biometric authentication was auto-cancelled after 30 seconds of inactivity to release device hardware locks per NBE standards.
              </p>
            </div>
          </div>
        ) : !isFingerprintSupported && !isCameraSupported ? (
          <div className="py-5 px-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl text-center space-y-2.5">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              No Biometric Sensor Detected
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 max-w-xs mx-auto leading-relaxed">
              Neither a platform fingerprint scanner nor a device camera was detected on this device. You can securely authenticate or register using your corporate password.
            </p>
          </div>
        ) : (
          <div className="py-2 flex flex-col items-center justify-center space-y-3">
            {authType === 'FACE' ? (
              /* Live Camera Viewport with Camera Permission Request */
              <div className="flex flex-col items-center gap-2">
                <div className="relative w-36 h-36 rounded-full overflow-hidden border-3 border-teal-500/50 bg-slate-900 shadow-lg shadow-teal-500/20 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover transition-opacity duration-300 ${
                      cameraActive ? 'opacity-100 scale-x-[-1]' : 'opacity-0'
                    }`}
                  />

                  {!cameraActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-slate-300 text-xs text-center bg-slate-950/80">
                      <Camera className="w-7 h-7 mb-1 text-teal-400 animate-pulse" />
                      <span className="font-semibold text-[11px]">
                        {statusMessage?.includes('denied') ? 'Camera Access Needed' : 'Activating Camera...'}
                      </span>
                      <button
                        type="button"
                        onClick={requestCameraStream}
                        className="mt-2 px-2.5 py-1 text-[10px] font-bold bg-teal-600 hover:bg-teal-500 text-white rounded-lg shadow cursor-pointer touch-press transition-all flex items-center gap-1"
                      >
                        <ScanFace className="w-3 h-3" />
                        <span>Allow Camera</span>
                      </button>
                    </div>
                  )}

                  {/* Facial Scanning Reticle Ring & Oval Guide */}
                  {cameraActive && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-24 h-32 border border-dashed border-teal-400/80 rounded-[50%] animate-pulse"></div>
                      {scanState === 'SCANNING' && (
                        <div className="absolute top-0 left-0 right-0 h-1 bg-teal-400 shadow-md shadow-teal-400 animate-bounce"></div>
                      )}
                    </div>
                  )}

                  {scanState === 'SUCCESS' && (
                    <div className="absolute inset-0 bg-emerald-600/80 flex items-center justify-center text-white backdrop-blur-xs">
                      <CheckCircle2 className="w-12 h-12 text-white animate-in zoom-in-75 duration-200" />
                    </div>
                  )}
                </div>

                {!cameraActive && (
                  <button
                    type="button"
                    onClick={requestCameraStream}
                    className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Click here to allow camera access</span>
                  </button>
                )}
              </div>
            ) : (
              /* Fingerprint Sensor Target */
              <button
                type="button"
                onClick={handleExecuteBiometric}
                disabled={scanState === 'SCANNING' || scanState === 'SUCCESS' || !isFingerprintSupported}
                className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer touch-press outline-none ${
                  scanState === 'SUCCESS'
                    ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/40 scale-105'
                    : scanState === 'SCANNING'
                    ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 animate-pulse shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800/80 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-emerald-400 border-2 border-dashed border-emerald-500/40 active:scale-95'
                }`}
                aria-label="Tap to scan fingerprint"
              >
                {scanState === 'SCANNING' && (
                  <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60"></span>
                )}

                {scanState === 'SUCCESS' ? (
                  <CheckCircle2 className="w-12 h-12 text-white animate-in zoom-in-75 duration-200" />
                ) : (
                  <Fingerprint
                    className={`w-12 h-12 transition-transform duration-300 ${
                      scanState === 'SCANNING' ? 'scale-110 text-emerald-400' : ''
                    }`}
                  />
                )}
              </button>
            )}

            {/* Feedback & Instruction Label */}
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {scanState === 'SUCCESS'
                  ? mode === 'REGISTER'
                    ? 'Biometric Enrolled Successfully!'
                    : 'Biometric Verified!'
                  : scanState === 'SCANNING'
                  ? `Scanning ${authType === 'FINGERPRINT' ? 'Fingerprint' : 'Facial Profile'}...`
                  : scanState === 'ERROR'
                  ? 'Authentication Not Completed'
                  : authType === 'FACE'
                  ? cameraActive
                    ? 'Face ID Webcam Ready'
                    : 'Camera Access Required'
                  : 'Fingerprint Sensor Ready'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {statusMessage ||
                  (authType === 'FACE'
                    ? cameraActive
                      ? 'Webcam ready • Center your face within the guide reticle'
                      : 'Please grant camera access in your browser to proceed'
                    : isFingerprintSupported
                    ? 'Touch device fingerprint sensor or platform passkey'
                    : 'Use device platform sensor or switch to camera')}
              </p>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="space-y-2 pt-1">
          {scanState === 'TIMEOUT' ? (
            <>
              {/* Prominent Retry Button on Timeout */}
              <button
                type="button"
                onClick={handleRetry}
                className="w-full min-h-[44px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer touch-press"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry Biometric Scan</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  stopCameraStream();
                  onCancel();
                }}
                className="w-full min-h-[44px] py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer touch-press"
              >
                Continue with Password
              </button>
            </>
          ) : !isFingerprintSupported && !isCameraSupported ? (
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                onCancel();
              }}
              className="w-full min-h-[44px] py-2.5 px-4 bg-ob-indigo-600 hover:bg-ob-indigo-700 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer touch-press"
            >
              <Lock className="w-4 h-4" />
              <span>Continue with Password</span>
            </button>
          ) : (
            <>
              {authType === 'FACE' && !cameraActive ? (
                /* Primary Camera Activation Button when Camera isn't active yet */
                <button
                  type="button"
                  onClick={requestCameraStream}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer touch-press"
                >
                  <Camera className="w-4 h-4" />
                  <span>Allow Camera Access / Start Webcam</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExecuteBiometric}
                  disabled={scanState === 'SCANNING' || scanState === 'SUCCESS' || (authType === 'FINGERPRINT' && !isFingerprintSupported) || (authType === 'FACE' && !cameraActive && !isCameraSupported)}
                  className={`w-full min-h-[44px] py-2.5 px-4 disabled:opacity-60 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer touch-press ${
                    authType === 'FACE'
                      ? 'bg-teal-600 hover:bg-teal-500'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {scanState === 'SUCCESS' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Verified • Complete</span>
                    </>
                  ) : scanState === 'SCANNING' ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Analyzing Biometrics...</span>
                    </>
                  ) : (
                    <>
                      {authType === 'FINGERPRINT' ? (
                        <Fingerprint className="w-4 h-4" />
                      ) : (
                        <ScanFace className="w-4 h-4" />
                      )}
                      <span>
                        {mode === 'REGISTER'
                          ? authType === 'FACE'
                            ? 'Capture & Register Face'
                            : 'Scan & Register Fingerprint'
                          : authType === 'FACE'
                          ? 'Scan Face to Sign In'
                          : 'Scan Fingerprint to Sign In'}
                      </span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  stopCameraStream();
                  onCancel();
                }}
                className="w-full min-h-[44px] py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer touch-press"
              >
                Cancel / Use Password
              </button>
            </>
          )}
        </div>
      </div>

      {/* Embedded Hardware Diagnostics Modal */}
      <HardwareDiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
    </div>
  );
};
